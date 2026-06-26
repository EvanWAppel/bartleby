"""Async Hocuspocus client.

Wraps a ``y_py.YDoc`` and a single WebSocket connection. Bidirectional sync
follows the protocol documented in ``protocol.py``:

1. On connect we send SyncStep1 carrying our state vector.
2. On every incoming Sync message we dispatch the sub-message:
   - SyncStep1 from server: reply with SyncStep2 covering what we have.
   - SyncStep2 from server: apply the update; mark ourselves synced.
   - SyncUpdate from server: apply the update.
3. Local YDoc updates (from any caller) are forwarded as SyncUpdate.
4. Awareness frames update an in-memory ``{client_id: state}`` map and
   trigger registered listeners (T-018 status bar uses this for presence).

Auth, stateless, and other Hocuspocus message variants are still ignored
so the connection stays alive while we add features incrementally.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable, Coroutine
from types import TracebackType
from typing import Any, Self

import websockets
import y_py as Y

from bartleby_tui.awareness import (
    AwarenessEntry,
    decode_awareness_message_payload,
    encode_awareness_message_payload,
)
from bartleby_tui.protocol import (
    MESSAGE_TYPE_AWARENESS,
    MESSAGE_TYPE_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    build_auth_token,
    build_message,
    build_sync_step_1,
    build_sync_step_2,
    build_sync_update,
    decode_varbytes,
    decode_varuint,
    parse_message,
)

log = logging.getLogger(__name__)

UpdateListener = Callable[[bytes], None] | Callable[[bytes], Awaitable[None]]
StatusListener = Callable[[bool], None]
# Listener receives the peers-only map (local client_id excluded).
AwarenessListener = Callable[[dict[int, dict[str, Any]]], None]


class HocuspocusConnection:
    """Async client that keeps a ``y_py.YDoc`` in sync with a Hocuspocus room."""

    def __init__(
        self,
        url: str,
        doc_name: str,
        document: Y.YDoc,
        bearer_token: str | None = None,
    ) -> None:
        self.url = url.rstrip("/")
        self.doc_name = doc_name
        self.document = document
        self.bearer_token = bearer_token

        self._ws: websockets.ClientConnection | None = None
        self._recv_task: asyncio.Task[None] | None = None
        self._synced = asyncio.Event()
        self._closed = asyncio.Event()
        # Tracks updates that were just applied from the wire, so we don't
        # echo them back to the server.
        self._applying_remote = False
        # y-py's observe_after_transaction returns a SubscriptionId opaque
        # object. We hold a reference so it isn't GC'd (which would silently
        # drop the subscription).
        self._sub_handle: object | None = None
        self._update_listeners: list[UpdateListener] = []
        # T-018: status listeners fire when the connection transitions
        # between "ws established + ready" and "closed". Awareness listeners
        # fire whenever peer state changes (join, leave, value updated).
        self._status_listeners: list[StatusListener] = []
        self._awareness_listeners: list[AwarenessListener] = []
        self._connected: bool = False
        # Full awareness table keyed by client_id (includes us). We track
        # the per-client clock so out-of-order frames are dropped per the
        # y-protocols/awareness contract.
        self._awareness_states: dict[int, dict[str, Any]] = {}
        self._awareness_clocks: dict[int, int] = {}
        # Local awareness state we should re-announce on (re)connect and
        # bump the clock for on every change.
        self._local_state: dict[str, Any] | None = None
        self._local_clock: int = 0
        # Keep strong refs to fire-and-forget tasks so the event loop doesn't
        # GC them mid-flight (per Python asyncio docs).
        self._pending_tasks: set[asyncio.Task[None]] = set()

    @property
    def is_synced(self) -> bool:
        return self._synced.is_set()

    @property
    def is_connected(self) -> bool:
        """True between successful WebSocket open and close.

        T-018's status bar reads this to render ``● live`` vs ``○ offline``.
        Note: this is purely transport-level — being connected does not
        imply we've completed the sync handshake (use ``is_synced`` for that).
        """
        return self._connected

    @property
    def local_client_id(self) -> int:
        """The YDoc's client_id — used to filter ourselves out of presence."""
        return self.document.client_id

    @property
    def peer_awareness(self) -> dict[int, dict[str, Any]]:
        """Awareness states of *other* clients, keyed by client_id.

        Excludes our own ``local_client_id`` so callers (e.g. the status
        bar) can render "you" separately. Returns a snapshot copy.
        """
        return {
            cid: dict(state)
            for cid, state in self._awareness_states.items()
            if cid != self.local_client_id
        }

    async def wait_synced(self) -> None:
        await self._synced.wait()

    def on_document_update(self, listener: UpdateListener) -> None:
        """Register a callback fired after any update (local or remote) is applied.

        Useful for the textual app: subscribe to repaint when the YDoc changes.
        """
        self._update_listeners.append(listener)

    def on_status_change(self, listener: StatusListener) -> None:
        """Register a callback fired whenever the WS connection state flips."""
        self._status_listeners.append(listener)

    def on_awareness_change(self, listener: AwarenessListener) -> None:
        """Register a callback fired whenever any peer awareness state changes."""
        self._awareness_listeners.append(listener)

    def set_local_awareness(self, state: dict[str, Any] | None) -> None:
        """Publish our own awareness state to the server (and locally).

        Bumps the per-client clock so peers correctly recognize this as
        newer than any prior state for ``local_client_id``. When the
        connection is open, the new state is broadcast immediately; if
        we're offline, the latest value is queued for the next connect.
        """
        self._local_state = state
        self._local_clock += 1
        if state is None:
            self._awareness_states.pop(self.local_client_id, None)
        else:
            self._awareness_states[self.local_client_id] = dict(state)
        self._awareness_clocks[self.local_client_id] = self._local_clock

        if self._ws is None or self._closed.is_set():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            log.warning("set_local_awareness called outside running loop; deferring send")
            return
        self._spawn(loop, self._send_awareness())

    async def __aenter__(self) -> Self:
        self._ws = await websockets.connect(f"{self.url}/{self.doc_name}")
        self._set_connected(True)

        # Subscribe to local YDoc updates so we forward them to the server.
        self._sub_handle = self.document.observe_after_transaction(self._on_local_transaction)

        # Start receive loop.
        self._recv_task = asyncio.create_task(self._recv_loop(), name="hocuspocus-recv")

        # Hocuspocus queues all incoming traffic until the client sends an Auth
        # message; only then does it forward sync messages to the document.
        # Authenticated servers expect a Bearer token; unauthenticated local
        # servers still accept the empty token used by the vertical-slice tests.
        token = f"Bearer {self.bearer_token}" if self.bearer_token is not None else ""
        await self._ws.send(build_auth_token(self.doc_name, token))

        # Kick off sync handshake.
        sv = Y.encode_state_vector(self.document)
        await self._ws.send(build_sync_step_1(self.doc_name, bytes(sv)))

        # Re-announce any local awareness we have so peers see us
        # immediately after (re)connecting.
        if self._local_state is not None:
            await self._send_awareness()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._closed.set()
        # y-py 0.6 does not expose a documented unsubscribe API; dropping
        # the handle relies on the YDoc being garbage-collected soon after.
        # No error-suppression here on purpose.
        self._sub_handle = None
        if self._recv_task is not None:
            self._recv_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._recv_task
        if self._ws is not None:
            await self._ws.close()
        self._set_connected(False)

    # ------------------------------------------------------------------ recv

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for frame in self._ws:
                if isinstance(frame, str):
                    log.debug("ignoring text frame: %r", frame)
                    continue
                await self._handle_frame(frame)
        except websockets.ConnectionClosed:
            log.info("websocket closed for room %s", self.doc_name)
        finally:
            # Transport is gone — flip our status flag so the UI can react.
            self._set_connected(False)

    async def _handle_frame(self, frame: bytes) -> None:
        parsed = parse_message(frame)
        if parsed.msg_type == MESSAGE_TYPE_AWARENESS:
            self._handle_awareness_payload(parsed.payload)
            return
        if parsed.msg_type != MESSAGE_TYPE_SYNC:
            log.debug(
                "ignoring non-sync message (type=%d, len=%d)",
                parsed.msg_type,
                len(parsed.payload),
            )
            return

        # Sync payload: <sync_subtype:varuint><sync_data>
        sub_type, offset = decode_varuint(parsed.payload, 0)

        if sub_type == SYNC_STEP_1:
            their_state_vector, _ = decode_varbytes(parsed.payload, offset)
            update = Y.encode_state_as_update(self.document, their_state_vector)
            assert self._ws is not None
            await self._ws.send(build_sync_step_2(self.doc_name, bytes(update)))
            return

        if sub_type in (SYNC_STEP_2, SYNC_UPDATE):
            update, _ = decode_varbytes(parsed.payload, offset)
            self._apply_remote_update(update)
            if sub_type == SYNC_STEP_2:
                self._synced.set()
            return

        log.debug("unknown sync sub-type %d", sub_type)

    def _apply_remote_update(self, update: bytes) -> None:
        self._applying_remote = True
        try:
            Y.apply_update(self.document, update)
        finally:
            self._applying_remote = False
        self._notify_listeners(update)

    def _handle_awareness_payload(self, payload: bytes) -> None:
        try:
            entries = decode_awareness_message_payload(payload)
        except (IndexError, ValueError) as exc:
            # Bad frame — log and skip rather than killing the connection.
            log.warning("ignoring malformed awareness payload: %s", exc)
            return
        changed = False
        for entry in entries:
            prev_clock = self._awareness_clocks.get(entry.client_id, -1)
            if entry.clock < prev_clock:
                # Older than what we already have — y-protocols requires us
                # to drop it so a stale frame doesn't overwrite live state.
                continue
            self._awareness_clocks[entry.client_id] = entry.clock
            if entry.state is None:
                if entry.client_id in self._awareness_states:
                    del self._awareness_states[entry.client_id]
                    changed = True
            else:
                existing = self._awareness_states.get(entry.client_id)
                if existing != entry.state:
                    self._awareness_states[entry.client_id] = entry.state
                    changed = True
        if changed:
            self._notify_awareness_listeners()

    # ------------------------------------------------------------------ send

    def _on_local_transaction(self, event: object) -> None:
        # This runs synchronously inside y-py's transaction observer. Any
        # work that touches the YDoc (notify_listeners may trigger reads in
        # subscribers) MUST be deferred via call_soon to escape the callback
        # context, otherwise re-entrant y-py operations corrupt FFI state and
        # surface as SystemError on the next y-py call.
        if self._applying_remote:
            return
        update = self._extract_update(event)
        if update is None or len(update) == 0:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            log.warning("local transaction outside of running loop; dropping update")
            return
        loop.call_soon(self._notify_listeners, update)
        self._spawn(loop, self._send_update(update))

    @staticmethod
    def _extract_update(event: object) -> bytes | None:
        """Pull the update bytes off a y-py AfterTransactionEvent."""
        # y-py 0.6: event has `get_update()` returning bytes, or the event
        # itself is a Transaction with a `.update` attribute. Use whichever
        # is present; let any AttributeError surface (do not hide errors).
        getter = getattr(event, "get_update", None)
        if callable(getter):
            return bytes(getter())
        update = getattr(event, "update", None)
        if isinstance(update, (bytes, bytearray)):
            return bytes(update)
        return None

    async def _send_update(self, update: bytes) -> None:
        if self._ws is None or self._closed.is_set():
            return
        await self._ws.send(build_sync_update(self.doc_name, update))

    async def _send_awareness(self) -> None:
        if self._ws is None or self._closed.is_set():
            return
        entry = AwarenessEntry(
            client_id=self.local_client_id,
            clock=self._local_clock,
            state=self._local_state,
        )
        payload = encode_awareness_message_payload([entry])
        await self._ws.send(build_message(self.doc_name, MESSAGE_TYPE_AWARENESS, payload))

    # ------------------------------------------------------------------ misc

    def _notify_listeners(self, update: bytes) -> None:
        for listener in list(self._update_listeners):
            result = listener(update)
            if isinstance(result, Awaitable):
                coro = _as_coroutine(result)
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    log.warning("update listener returned coroutine outside loop")
                    coro.close()
                    continue
                self._spawn(loop, coro)

    def _notify_awareness_listeners(self) -> None:
        snapshot = self.peer_awareness
        for listener in list(self._awareness_listeners):
            listener(snapshot)

    def _set_connected(self, value: bool) -> None:
        """Flip the connected flag and notify listeners on transitions."""
        if self._connected == value:
            return
        self._connected = value
        for listener in list(self._status_listeners):
            listener(value)

    def _spawn(
        self,
        loop: asyncio.AbstractEventLoop,
        coro: Coroutine[Any, Any, None],
    ) -> None:
        """Schedule a fire-and-forget coroutine while keeping a strong ref."""
        task = loop.create_task(coro)
        self._pending_tasks.add(task)
        task.add_done_callback(self._pending_tasks.discard)


async def _as_coroutine(awaitable: Awaitable[None]) -> None:
    """Wrap any awaitable as a coroutine for asyncio.create_task."""
    await awaitable

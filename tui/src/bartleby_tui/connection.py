"""Async Hocuspocus client.

Wraps a ``y_py.YDoc`` and a single WebSocket connection. Bidirectional sync
follows the protocol documented in ``protocol.py``:

1. On connect we send SyncStep1 carrying our state vector.
2. On every incoming Sync message we dispatch the sub-message:
   - SyncStep1 from server: reply with SyncStep2 covering what we have.
   - SyncStep2 from server: apply the update; mark ourselves synced.
   - SyncUpdate from server: apply the update.
3. Local YDoc updates (from any caller) are forwarded as SyncUpdate.

Awareness, auth, stateless, and presence messages are not handled in v1;
incoming variants are silently ignored so the connection stays alive.
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

from bartleby_tui.protocol import (
    MESSAGE_TYPE_SYNC,
    SYNC_STEP_1,
    SYNC_STEP_2,
    SYNC_UPDATE,
    build_auth_token,
    build_sync_step_1,
    build_sync_step_2,
    build_sync_update,
    decode_varbytes,
    decode_varuint,
    parse_message,
)

log = logging.getLogger(__name__)

UpdateListener = Callable[[bytes], None] | Callable[[bytes], Awaitable[None]]


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
        # Keep strong refs to fire-and-forget tasks so the event loop doesn't
        # GC them mid-flight (per Python asyncio docs).
        self._pending_tasks: set[asyncio.Task[None]] = set()

    @property
    def is_synced(self) -> bool:
        return self._synced.is_set()

    async def wait_synced(self) -> None:
        await self._synced.wait()

    def on_document_update(self, listener: UpdateListener) -> None:
        """Register a callback fired after any update (local or remote) is applied.

        Useful for the textual app: subscribe to repaint when the YDoc changes.
        """
        self._update_listeners.append(listener)

    async def __aenter__(self) -> Self:
        self._ws = await websockets.connect(f"{self.url}/{self.doc_name}")

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

    async def _handle_frame(self, frame: bytes) -> None:
        parsed = parse_message(frame)
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

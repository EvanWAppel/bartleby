"""Bartleby textual app.

Phase 0 (V-007/V-008) shipped a single editable widget bound to a Yjs
document via Hocuspocus. T-001 restructures the UI into the three-pane
shape the rest of Workstream T will populate:

    +---------------------------------------------------+
    |                   Header                          |
    +-----------+---------------------------------------+
    | #notes-   |          #editor-pane                 |
    |  pane     |                                       |
    |           |                                       |
    +-----------+---------------------------------------+
    |              #status-bar                          |
    +---------------------------------------------------+
    |                   Footer                          |
    +---------------------------------------------------+

Each region carries a stable ``id`` attribute so later tasks (T-007 notes
list, T-004 renderer) can target them without touching the skeleton. The
Phase 0 editor (BodyEditor) lives inside ``#editor-pane`` so the existing
live-collab behavior is preserved. T-018 replaces the status-bar
placeholder with a real ``StatusBar`` widget driven by connection +
awareness events.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, ClassVar, TextIO

import y_py as Y
from textual.app import App, ComposeResult
from textual.binding import BindingType
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, Header, Static, TextArea

from bartleby_tui.auth import TokenStore, UserInfo, ensure_access_token, fetch_user_info
from bartleby_tui.connection import HocuspocusConnection
from bartleby_tui.renderer import render_document, ydoc_to_blocks

log = logging.getLogger(__name__)

DEFAULT_DOC_NAME = "vertical-slice"
DEFAULT_SERVER_URL = "ws://127.0.0.1:1234"
# Spec target: list updates within 1s of a remote change. Poll at 1s so
# steady-state lag is bounded by the spec. Tests inject a smaller value.
DEFAULT_NOTES_POLL_SECONDS = 1.0


class BodyEditor(TextArea):
    """Plain editable surface bound to the YDoc body in V-008.

    V-009+ swap this for a ProseMirror-equivalent renderer that handles
    headings, lists, etc.; for now it's vanilla text.
    """

    DEFAULT_CSS = """
    BodyEditor {
        height: 1fr;
        padding: 1 2;
    }
    """


class DocumentRenderer(Static):
    """T-004: read-only renderer for the ProseMirror-style document.

    Subscribes (via the app) to the YDoc and repaints with the latest
    ``render_document(ydoc_to_blocks(...))`` output on every change.

    The editable ``BodyEditor`` (plain text on the ``body`` YText) still
    drives writes for now (T-005 owns the editing primitives that mutate
    the ``prosemirror`` XmlFragment). This widget exists so the rich
    document content already arriving via collab from web peers is
    visible in the TUI.
    """

    DEFAULT_CSS = """
    DocumentRenderer {
        height: auto;
        padding: 1 2;
        border-top: solid $primary;
    }
    """


class BartlebyApp(App[None]):
    """Bartleby TUI.

    T-001 owns the three-pane skeleton. The Phase 0 connection logic
    (V-007/V-008) still drives the editor inside ``#editor-pane`` so the
    existing live-collab tests keep passing.

    ``connect_on_mount=False`` lets layout-only tests mount the app
    without a running Hocuspocus server.
    """

    CSS = """
    Screen {
        background: $surface;
    }

    #main-row {
        height: 1fr;
    }

    #notes-pane {
        width: 24;
        min-width: 16;
        border-right: solid $primary;
        padding: 1;
    }

    #editor-pane {
        width: 1fr;
        padding: 0;
    }

    /* StatusBar carries its own DEFAULT_CSS; nothing to override here. */
    """

    BINDINGS: ClassVar[list[BindingType]] = [
        ("ctrl+q", "quit", "Quit"),
    ]

    def __init__(
        self,
        server_url: str = DEFAULT_SERVER_URL,
        doc_name: str = DEFAULT_DOC_NAME,
        connect_on_mount: bool = True,
        http_base_url: str | None = None,
        token_store: TokenStore | None = None,
        auth_output: TextIO | None = None,
        notes_poll_seconds: float = DEFAULT_NOTES_POLL_SECONDS,
    ) -> None:
        super().__init__()
        self._server_url = server_url
        self._doc_name = doc_name
        self._connect_on_mount = connect_on_mount
        self._http_base_url = http_base_url
        self._token_store = token_store
        self._auth_output = auth_output
        self._access_token: str | None = None
        # T-024: populated after we exchange the access token for /auth/me.
        # Exposed as a public attr so the presence rendering layer (T-018's
        # status bar) can read the server-assigned color without re-fetching.
        self.user_info: UserInfo | None = None
        self._doc = Y.YDoc()
        self.connection: HocuspocusConnection | None = None
        self._body_view: BodyEditor | None = None
        self._renderer_view: DocumentRenderer | None = None
        # Snapshot of the last text we pushed into the TextArea. We use it
        # to suppress echoes when the YDoc->TextArea sync emits a Changed.
        self._last_applied_text: str = ""

    @property
    def body_text(self) -> str:
        """Current value of the YDoc body — what would be exported as markdown."""
        return str(self._doc.get_text("body"))

    @property
    def rendered_body(self) -> str:
        """Text currently displayed in the editor widget."""
        if self._body_view is None:
            return ""
        return self._body_view.text

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="main-row"):
            # T-007: live notes list, polled from `GET /notes` once the
            # http_base_url is configured. When no http_base_url is set
            # (layout-only tests / Phase 0 fallback) the widget renders
            # an empty list and stays inert.
            notes_view = NotesList(id="notes-pane")
            self._notes_view = notes_view
            yield notes_view
            with Vertical(id="editor-pane"):
                view = BodyEditor(text="", id="body", show_line_numbers=False)
                self._body_view = view
                yield view
                renderer = DocumentRenderer("", id="document")
                self._renderer_view = renderer
                yield renderer
        # T-018 will wire connection state + presence into this bar.
        yield Static("", id="status-bar")
        yield Footer()

    async def on_mount(self) -> None:
        if not self._connect_on_mount:
            if self._body_view is not None:
                self._body_view.focus()
            return

        log.info("connecting to %s room=%s", self._server_url, self._doc_name)
        if self._http_base_url is not None:
            self._access_token = await ensure_access_token(
                self._http_base_url,
                store=self._token_store,
                output=self._auth_output if self._auth_output is not None else sys.stderr,
            )
            # T-024: pick up the server-assigned color (and id/email/name)
            # so T-018's presence layer can use it.
            self.user_info = await fetch_user_info(self._http_base_url, self._access_token)
            log.info(
                "auth/me: id=%s display_name=%s color=%s",
                self.user_info.id,
                self.user_info.display_name,
                self.user_info.color,
            )
        self.connection = HocuspocusConnection(
            url=self._server_url,
            doc_name=self._doc_name,
            document=self._doc,
            bearer_token=self._access_token,
        )
        self.connection.on_document_update(self._on_doc_update)
        self.connection.on_status_change(self._on_status_change)
        self.connection.on_awareness_change(self._on_awareness_change)
        await self.connection.__aenter__()
        # Initial paint from server state if any arrived during sync.
        self._refresh_from_doc()
        self._refresh_renderer()
        if self._body_view is not None:
            self._body_view.focus()

        # T-007: kick off the notes-list polling loop. We only poll when an
        # http_base_url is configured because the REST endpoint lives on the
        # HTTP server, not Hocuspocus. set_interval fires `interval` seconds
        # *after* mount; do one immediate fetch so the list isn't blank.
        if self._http_base_url is not None:
            await self._refresh_notes()
            self._notes_timer = self.set_interval(
                self._notes_poll_seconds,
                self._refresh_notes,
                name="notes-poll",
            )

    async def on_unmount(self) -> None:
        if self._notes_timer is not None:
            self._notes_timer.stop()
            self._notes_timer = None
        if self.connection is not None:
            await self.connection.__aexit__(None, None, None)
            self.connection = None

    # --------------------------------------------------- connection -> status bar

    def _on_status_change(self, connected: bool) -> None:
        """Forward WS connect/disconnect transitions to the status bar."""
        if self._status_bar is None:
            return
        self._status_bar.set_connected(connected)

    def _on_awareness_change(self, peers: dict[int, dict[str, Any]]) -> None:
        """Forward peer-awareness updates to the status bar's presence section."""
        if self._status_bar is None:
            return
        self._status_bar.set_peers(peers)

    # ------------------------------------------------------------------ YDoc -> view

    def _on_doc_update(self, _update: bytes) -> None:
        # Listener is dispatched via loop.call_soon by the connection, so
        # we're already outside the y-py callback context here.
        self._refresh_from_doc()
        self._refresh_renderer()

    def _refresh_from_doc(self) -> None:
        """Pull the YDoc body into the TextArea only when safe to do so.

        We deliberately *do not* overwrite the TextArea if the user has
        actively edited it (i.e. its current text equals our last_applied
        snapshot). Replacing a buffer mid-edit reaches into the wrong async
        slot and causes empty Changed events to mask user input — see
        commit history for the V-008 debugging session.

        For the v1 vertical slice this means: a TUI that is currently being
        edited won't auto-redraw to show a peer's late-arriving update. The
        full prose-mirror-style merge belongs to a later task.
        """
        if self._body_view is None:
            return
        text = str(self._doc.get_text("body"))
        view_text = self._body_view.text
        if text == view_text:
            return
        if view_text != self._last_applied_text:
            # User has typed since we last wrote — leave their buffer alone.
            return
        self._last_applied_text = text
        self._body_view.load_text(text)

    def _refresh_renderer(self) -> None:
        """Repaint the DocumentRenderer pane from the YDoc's prosemirror fragment.

        Safe to call any time after on_mount — it no-ops if the widget
        hasn't been composed yet. Any failure walking the fragment
        propagates per agents.md ("do not hide or wrap errors").
        """
        if self._renderer_view is None:
            return
        blocks = ydoc_to_blocks(self._doc)
        self._renderer_view.update(render_document(blocks))

    # ------------------------------------------------------------------ view -> YDoc

    def on_text_area_changed(self, event: TextArea.Changed) -> None:
        if event.text_area is not self._body_view:
            return
        new_text = event.text_area.text
        if new_text == self._last_applied_text:
            return
        self._sync_to_doc(new_text)

    def _sync_to_doc(self, new_text: str) -> None:
        body = self._doc.get_text("body")
        with self._doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            current_len = len(str(body))
            if current_len > 0:
                body.delete_range(txn, 0, current_len)
            if new_text:
                body.insert(txn, 0, new_text)
        self._last_applied_text = new_text


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    BartlebyApp(http_base_url=os.environ.get("BARTLEBY_HTTP_URL")).run()

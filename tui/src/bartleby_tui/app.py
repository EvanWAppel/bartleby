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
list, T-004 renderer, T-018 status bar) can target them without touching
the skeleton. The Phase 0 editor (BodyEditor) lives inside ``#editor-pane``
so the existing live-collab behavior is preserved.
"""

from __future__ import annotations

import logging
from typing import ClassVar

import y_py as Y
from textual.app import App, ComposeResult
from textual.binding import BindingType
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, Header, Static, TextArea

from bartleby_tui.connection import HocuspocusConnection

log = logging.getLogger(__name__)

DEFAULT_DOC_NAME = "vertical-slice"
DEFAULT_SERVER_URL = "ws://127.0.0.1:1234"


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

    #status-bar {
        dock: bottom;
        height: 1;
        background: $boost;
        color: $text;
        padding: 0 1;
    }
    """

    BINDINGS: ClassVar[list[BindingType]] = [
        ("ctrl+q", "quit", "Quit"),
    ]

    def __init__(
        self,
        server_url: str = DEFAULT_SERVER_URL,
        doc_name: str = DEFAULT_DOC_NAME,
        connect_on_mount: bool = True,
    ) -> None:
        super().__init__()
        self._server_url = server_url
        self._doc_name = doc_name
        self._connect_on_mount = connect_on_mount
        self._doc = Y.YDoc()
        self.connection: HocuspocusConnection | None = None
        self._body_view: BodyEditor | None = None
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
            # T-007 will replace this Static with a live note list widget.
            yield Static("Notes", id="notes-pane")
            with Vertical(id="editor-pane"):
                view = BodyEditor(text="", id="body", show_line_numbers=False)
                self._body_view = view
                yield view
        # T-018 will wire connection state + presence into this bar.
        yield Static("", id="status-bar")
        yield Footer()

    async def on_mount(self) -> None:
        if not self._connect_on_mount:
            if self._body_view is not None:
                self._body_view.focus()
            return

        log.info("connecting to %s room=%s", self._server_url, self._doc_name)
        self.connection = HocuspocusConnection(
            url=self._server_url,
            doc_name=self._doc_name,
            document=self._doc,
        )
        self.connection.on_document_update(self._on_doc_update)
        await self.connection.__aenter__()
        # Initial paint from server state if any arrived during sync.
        self._refresh_from_doc()
        if self._body_view is not None:
            self._body_view.focus()

    async def on_unmount(self) -> None:
        if self.connection is not None:
            await self.connection.__aexit__(None, None, None)
            self.connection = None

    # ------------------------------------------------------------------ YDoc -> view

    def _on_doc_update(self, _update: bytes) -> None:
        # Listener is dispatched via loop.call_soon by the connection, so
        # we're already outside the y-py callback context here.
        self._refresh_from_doc()

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
    BartlebyApp().run()

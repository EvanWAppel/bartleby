"""Minimal Bartleby textual app for Phase 0.

Mounts a single read-only widget that renders the body of the YDoc shared
via Hocuspocus. V-008 will swap the widget for an editable surface.
"""

from __future__ import annotations

import logging
from typing import ClassVar

import y_py as Y
from textual.app import App, ComposeResult
from textual.binding import BindingType
from textual.widgets import Footer, Header, Static

from bartleby_tui.connection import HocuspocusConnection

log = logging.getLogger(__name__)

DEFAULT_DOC_NAME = "vertical-slice"
DEFAULT_SERVER_URL = "ws://127.0.0.1:1234"


class BodyView(Static):
    """Renders the YDoc body as plain text. Editable in V-008."""

    DEFAULT_CSS = """
    BodyView {
        padding: 1 2;
        height: 1fr;
    }
    """


class BartlebyApp(App[None]):
    """Bartleby TUI. Phase 0: read-only viewer for one hardcoded room."""

    CSS = """
    Screen {
        background: $surface;
    }
    """

    BINDINGS: ClassVar[list[BindingType]] = [
        ("q", "quit", "Quit"),
    ]

    def __init__(
        self,
        server_url: str = DEFAULT_SERVER_URL,
        doc_name: str = DEFAULT_DOC_NAME,
    ) -> None:
        super().__init__()
        self._server_url = server_url
        self._doc_name = doc_name
        self._doc = Y.YDoc()
        self.connection: HocuspocusConnection | None = None
        self._body_view: BodyView | None = None
        # Mirrors the text currently shown in the body widget. Tests assert
        # against this rather than introspecting textual internals.
        self.rendered_body: str = ""

    def compose(self) -> ComposeResult:
        yield Header()
        view = BodyView("(connecting...)", id="body")
        self._body_view = view
        yield view
        yield Footer()

    async def on_mount(self) -> None:
        log.info("connecting to %s room=%s", self._server_url, self._doc_name)
        self.connection = HocuspocusConnection(
            url=self._server_url,
            doc_name=self._doc_name,
            document=self._doc,
        )
        self.connection.on_document_update(self._on_doc_update)
        await self.connection.__aenter__()
        self._refresh_body()

    async def on_unmount(self) -> None:
        if self.connection is not None:
            await self.connection.__aexit__(None, None, None)
            self.connection = None

    def _on_doc_update(self, _update: bytes) -> None:
        # Update listener fires from y-py's transaction observer. We must
        # only touch widget state from the textual loop; call_from_thread
        # would be needed if y-py used a real thread, but here we're on the
        # same loop already.
        self._refresh_body()

    def _refresh_body(self) -> None:
        if self._body_view is None:
            return
        text = str(self._doc.get_text("body"))
        self.rendered_body = text
        self._body_view.update(text or "(empty)")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    BartlebyApp().run()

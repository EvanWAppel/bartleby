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
list) can target them without touching the skeleton. T-006's
``StructuredEditor`` (``#editor``) lives inside ``#editor-pane`` and edits the
``prosemirror`` fragment directly — it superseded the Phase 0 flat-text
``BodyEditor`` + read-only ``DocumentRenderer`` pair. T-018 drives the
``StatusBar`` (``#status-bar``) from connection + awareness events.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, ClassVar, TextIO

import y_py as Y
from textual import events
from textual.app import App, ComposeResult
from textual.binding import BindingType
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.timer import Timer
from textual.widgets import Footer, Header, Input, OptionList

from bartleby_tui.auth import TokenStore, UserInfo, ensure_access_token, fetch_user_info
from bartleby_tui.connection import HocuspocusConnection
from bartleby_tui.editor import StructuredEditor
from bartleby_tui.notes_api import Note, fetch_notes, search_notes
from bartleby_tui.notes_list import NotesList
from bartleby_tui.renderer import Block, ydoc_to_blocks
from bartleby_tui.status_bar import StatusBar


class SearchInput(Input):
    """Search box in the notes pane. Esc cancels (T-008)."""

    class Cancelled(Message):
        """Posted when the user presses Esc to dismiss the search box."""

    def on_key(self, event: events.Key) -> None:
        if event.key == "escape":
            event.stop()
            event.prevent_default()
            self.post_message(self.Cancelled())


log = logging.getLogger(__name__)

DEFAULT_DOC_NAME = "vertical-slice"
DEFAULT_SERVER_URL = "ws://127.0.0.1:1234"
# Spec target: list updates within 1s of a remote change. Poll at 1s so
# steady-state lag is bounded by the spec. Tests inject a smaller value.
DEFAULT_NOTES_POLL_SECONDS = 1.0


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

    #notes-col {
        width: 24;
        min-width: 16;
        border-right: solid $primary;
        padding: 1;
    }

    #notes-pane {
        height: 1fr;
        padding: 0;
    }

    #note-search {
        display: none;
        height: 3;
    }

    #note-search.searching {
        display: block;
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
        self._notes_poll_seconds = notes_poll_seconds
        self._access_token: str | None = None
        # T-024: populated after we exchange the access token for /auth/me.
        # Exposed as a public attr so the presence rendering layer (T-018's
        # status bar) can read the server-assigned color without re-fetching.
        self.user_info: UserInfo | None = None
        self._doc = Y.YDoc()
        self.connection: HocuspocusConnection | None = None
        # T-006 structured editor (edits the prosemirror fragment in place).
        self._editor: StructuredEditor | None = None
        # T-007 notes pane + its polling timer; T-018 status bar. Assigned in
        # compose()/on_mount(); declared here so attribute access is typed and
        # the connect_on_mount=False path has safe defaults.
        self._notes_view: NotesList | None = None
        self._notes_timer: Timer | None = None
        self._status_bar: StatusBar | None = None
        # T-008 search: the full polled list (cache to restore after a search)
        # + the search box + whether we're currently showing search results.
        self._all_notes: list[Note] = []
        self._search_input: SearchInput | None = None
        self._searching: bool = False

    @property
    def body_text(self) -> str:
        """Plain text of the document (concatenated leaf-block text).

        Sourced from the ``prosemirror`` fragment the editor and web client
        share. One line per leaf block.
        """
        blocks = ydoc_to_blocks(self._doc)
        return "\n".join(_block_plain_text(b) for b in blocks)

    @property
    def rendered_body(self) -> str:
        """Plain text currently represented by the document (no caret marker)."""
        return self.body_text

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="main-row"):
            # T-007: live notes list, polled from `GET /notes` once the
            # http_base_url is configured. When no http_base_url is set
            # (layout-only tests / Phase 0 fallback) the widget renders
            # an empty list and stays inert.
            with Vertical(id="notes-col"):
                # T-008: hidden until `/`; filters the list via GET /search.
                search_input = SearchInput(placeholder="search…", id="note-search")
                self._search_input = search_input
                yield search_input
                notes_view = NotesList(id="notes-pane")
                self._notes_view = notes_view
                yield notes_view
            with Vertical(id="editor-pane"):
                # T-006: structured editor over the prosemirror fragment.
                editor = StructuredEditor(self._doc, id="editor")
                self._editor = editor
                yield editor
        # T-018: connection state + presence. on_status_change/on_awareness_change
        # drive set_connected/set_peers on this widget.
        status_bar = StatusBar(id="status-bar")
        self._status_bar = status_bar
        yield status_bar
        yield Footer()

    async def on_mount(self) -> None:
        if not self._connect_on_mount:
            if self._editor is not None:
                self._editor.focus()
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
        await self._connect_room()
        if self._editor is not None:
            self._editor.focus()

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

    # ------------------------------------------------------------ note navigation

    async def _connect_room(self) -> None:
        """Open a Hocuspocus connection to the current ``_doc_name`` + ``_doc``.

        Shared by initial mount and ``open_note`` so opening a note reuses the
        exact same wiring (document-update, status, awareness callbacks).
        """
        log.info("connecting to %s room=%s", self._server_url, self._doc_name)
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
        # Paint whatever server state arrived during the sync handshake.
        if self._editor is not None:
            self._editor.refresh_view()

    async def open_note(self, note_id: str) -> None:
        """Switch the editor to note ``note_id`` (Hocuspocus room ``note:<id>``).

        Tears down the current room's connection, swaps in a fresh YDoc, points
        the editor at it, and (when online) reconnects to the new room. A no-op
        if we're already on that note.
        """
        doc_name = f"note:{note_id}"
        if doc_name == self._doc_name:
            return
        if self.connection is not None:
            await self.connection.__aexit__(None, None, None)
            self.connection = None
        self._doc = Y.YDoc()
        self._doc_name = doc_name
        if self._editor is not None:
            self._editor.set_doc(self._doc)
        if self._connect_on_mount:
            await self._connect_room()

    async def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        """Open the selected note (Enter / click on a notes-list row)."""
        if self._notes_view is None or event.option_list is not self._notes_view:
            return
        note_id = event.option.id
        if note_id is not None:
            await self.open_note(note_id)

    # ----------------------------------------------------------- notes polling

    async def _refresh_notes(self) -> None:
        """Poll ``GET /notes`` and push the result into the notes pane (T-007).

        No-ops when there is no HTTP base URL (Phase 0 / layout-only runs) or
        before the notes pane has composed. ``set_notes`` diffs internally, so
        an unchanged list leaves the user's selection untouched.
        """
        if self._http_base_url is None or self._notes_view is None:
            return
        notes = await fetch_notes(self._http_base_url, self._access_token)
        self._all_notes = notes
        # While a search is on screen, leave the filtered view in place; the
        # cache above keeps the full list fresh for when the search closes.
        if not self._searching:
            self._notes_view.set_notes(notes)

    # ---------------------------------------------------------------- T-008 search

    def on_structured_editor_search_requested(
        self, _message: StructuredEditor.SearchRequested
    ) -> None:
        """`/` in the editor's normal mode opens the search box."""
        self._open_search()

    def _open_search(self) -> None:
        if self._search_input is None:
            return
        self._searching = True
        self._search_input.add_class("searching")
        self._search_input.value = ""
        self._search_input.focus()

    def on_search_input_cancelled(self, _message: SearchInput.Cancelled) -> None:
        """Esc in the search box: restore the full list and refocus the editor."""
        self._close_search()

    def _close_search(self) -> None:
        if self._search_input is not None:
            self._search_input.remove_class("searching")
            self._search_input.value = ""
        self._searching = False
        if self._notes_view is not None:
            self._notes_view.set_notes(self._all_notes)
        if self._editor is not None:
            self._editor.focus()

    async def on_input_changed(self, event: Input.Changed) -> None:
        if event.input is not self._search_input:
            return
        await self._run_search(event.value)

    async def _run_search(self, query: str) -> None:
        """Filter the notes list to GET /search hits (back-filled from cache)."""
        if self._notes_view is None:
            return
        if not query or self._http_base_url is None:
            self._notes_view.set_notes(self._all_notes if not query else [])
            return
        hit_ids = await search_notes(self._http_base_url, query, self._access_token)
        by_id = {note.id: note for note in self._all_notes}
        # Preserve the server's relevance order; drop hits we have no row for.
        results = [by_id[hid] for hid in hit_ids if hid in by_id]
        self._notes_view.set_notes(results)

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        """Enter in the search box opens the top result."""
        if event.input is not self._search_input:
            return
        top = self._notes_view.notes[0] if self._notes_view and self._notes_view.notes else None
        self._close_search()
        if top is not None:
            await self.open_note(top.id)

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
        # we're already outside the y-py callback context here. The editor
        # owns both reading and writing the prosemirror fragment, so a remote
        # update just triggers a repaint (the caret is re-clamped to a valid
        # position inside refresh_view).
        if self._editor is not None:
            self._editor.refresh_view()


def _block_plain_text(block: Block) -> str:
    """Concatenate a block's text, recursing into container children."""
    if block.children:
        return " ".join(_block_plain_text(child) for child in block.children)
    return "".join(inline.text for inline in block.inlines)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    BartlebyApp(http_base_url=os.environ.get("BARTLEBY_HTTP_URL")).run()

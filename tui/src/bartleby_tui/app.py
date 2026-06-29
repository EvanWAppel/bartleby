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
from textual.widgets import Footer, Header, Input, Label, OptionList
from textual.widgets.option_list import Option

from bartleby_tui.auth import TokenStore, UserInfo, ensure_access_token, fetch_user_info
from bartleby_tui.connection import HocuspocusConnection
from bartleby_tui.editor import StructuredEditor
from bartleby_tui.modals import ConfirmModal, HelpModal, RenameModal, TextInputModal
from bartleby_tui.notes_api import (
    Note,
    create_comment,
    create_note,
    delete_note,
    delete_note_forever,
    fetch_backlinks,
    fetch_comments,
    fetch_mentions,
    fetch_notes,
    fetch_snapshots,
    fetch_trash,
    mark_mention_read,
    rename_note,
    reply_comment,
    resolve_comment,
    restore_note,
    restore_snapshot,
    search_notes,
)
from bartleby_tui.notes_list import NotesList
from bartleby_tui.panes import (
    BacklinksPane,
    CommentsPane,
    MentionsPane,
    SnapshotsPane,
    TrashPane,
)
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


class TagPicker(OptionList):
    """Pop-over list of tags in the notes pane. Esc cancels (T-009)."""

    class Cancelled(Message):
        """Posted when the user presses Esc to dismiss the tag picker."""

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

    #tag-picker {
        display: none;
        height: auto;
        max-height: 8;
        border: round $primary;
    }

    #tag-picker.filtering {
        display: block;
    }

    #editor-pane {
        width: 1fr;
        padding: 0;
    }

    #right-pane {
        display: none;
        width: 28;
        min-width: 18;
        border-left: solid $primary;
        padding: 1;
    }

    #right-pane.visible {
        display: block;
    }

    #right-pane-title {
        text-style: bold;
        padding: 0 0 1 0;
    }

    #backlinks-pane, #trash-pane, #inbox-pane, #history-pane, #comments-pane {
        display: none;
        height: 1fr;
    }

    #backlinks-pane.active, #trash-pane.active, #inbox-pane.active,
    #history-pane.active, #comments-pane.active {
        display: block;
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
        # T-009 tag filter: the picker widget + the currently-applied tag.
        self._tag_picker: TagPicker | None = None
        self._active_tag: str | None = None
        # T-010 CRUD: last soft-deleted note id, so `R` can restore it.
        self._last_deleted: str | None = None
        # T-012/T-016/T-017 right-pane panes + which one is showing (None = hidden).
        self._backlinks_pane: BacklinksPane | None = None
        self._trash_pane: TrashPane | None = None
        self._mentions_pane: MentionsPane | None = None
        self._snapshots_pane: SnapshotsPane | None = None
        self._comments_pane: CommentsPane | None = None
        self._active_pane: str | None = None

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
                # T-009: hidden until `t`; picks a tag to filter the list by.
                tag_picker = TagPicker(id="tag-picker")
                self._tag_picker = tag_picker
                yield tag_picker
                notes_view = NotesList(id="notes-pane")
                self._notes_view = notes_view
                yield notes_view
            with Vertical(id="editor-pane"):
                # T-006: structured editor over the prosemirror fragment.
                editor = StructuredEditor(self._doc, id="editor")
                self._editor = editor
                yield editor
            # T-012: collapsible right pane (inbound links; comments/history join
            # it later). Hidden until a `g<key>` chord toggles it.
            with Vertical(id="right-pane"):
                yield Label("", id="right-pane-title")
                backlinks_pane = BacklinksPane(id="backlinks-pane")
                self._backlinks_pane = backlinks_pane
                yield backlinks_pane
                trash_pane = TrashPane(id="trash-pane")
                self._trash_pane = trash_pane
                yield trash_pane
                mentions_pane = MentionsPane(id="inbox-pane")
                self._mentions_pane = mentions_pane
                yield mentions_pane
                snapshots_pane = SnapshotsPane(id="history-pane")
                self._snapshots_pane = snapshots_pane
                yield snapshots_pane
                comments_pane = CommentsPane(id="comments-pane")
                self._comments_pane = comments_pane
                yield comments_pane
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

    async def on_structured_editor_backlink_follow_requested(
        self, message: StructuredEditor.BacklinkFollowRequested
    ) -> None:
        """T-011: Enter over a `[[backlink]]` opens the linked note."""
        await self.open_note(message.target_id)

    def on_structured_editor_help_requested(self, _message: StructuredEditor.HelpRequested) -> None:
        """T-020: `?` opens the scrollable keybind reference."""
        self.push_screen(HelpModal())

    # `g<key>` → pane name.
    _PANE_FOR_CHORD: ClassVar[dict[str, str]] = {
        "b": "backlinks",
        "t": "trash",
        "i": "inbox",
        "h": "history",
        "c": "comments",
    }
    # CSS ids of the swappable right-pane panes (one is `.active` at a time).
    _PANE_IDS: ClassVar[tuple[str, ...]] = (
        "#backlinks-pane",
        "#trash-pane",
        "#inbox-pane",
        "#history-pane",
        "#comments-pane",
    )

    async def on_structured_editor_go_to_requested(
        self, message: StructuredEditor.GoToRequested
    ) -> None:
        """Route a `g<key>` chord to its right-pane (T-012 `g b`, T-016 `g t`)."""
        pane = self._PANE_FOR_CHORD.get(message.target)
        if pane is not None:
            await self._toggle_pane(pane)

    async def _toggle_pane(self, name: str) -> None:
        """Show ``name`` in the right pane (populating it), or hide if already shown."""
        right = self.query_one("#right-pane")
        if self._active_pane == name and right.has_class("visible"):
            right.remove_class("visible")
            self._active_pane = None
            if self._editor is not None:
                self._editor.focus()
            return

        active = await self._populate_pane(name)
        if active is None:
            return
        for pane_id in self._PANE_IDS:
            self.query_one(pane_id).set_class(pane_id == f"#{name}-pane", "active")
        self.query_one("#right-pane-title", Label).update(name.capitalize())
        right.add_class("visible")
        self._active_pane = name
        active.focus()

    async def _populate_pane(self, name: str) -> OptionList | None:
        """Fetch + load the named pane's data; return the widget to focus."""
        if name == "backlinks" and self._backlinks_pane is not None:
            note_id = self._current_note_id()
            links = (
                await fetch_backlinks(self._http_base_url, note_id, self._access_token)
                if note_id is not None and self._http_base_url is not None
                else []
            )
            self._backlinks_pane.set_backlinks(links)
            return self._backlinks_pane
        if name == "trash" and self._trash_pane is not None:
            await self._refresh_trash()
            return self._trash_pane
        if name == "inbox" and self._mentions_pane is not None:
            await self._refresh_mentions()
            return self._mentions_pane
        if name == "history" and self._snapshots_pane is not None:
            note_id = self._current_note_id()
            snaps = (
                await fetch_snapshots(self._http_base_url, note_id, self._access_token)
                if note_id is not None and self._http_base_url is not None
                else []
            )
            self._snapshots_pane.set_snapshots(snaps)
            return self._snapshots_pane
        if name == "comments" and self._comments_pane is not None:
            await self._refresh_comments()
            return self._comments_pane
        return None

    async def _refresh_comments(self) -> None:
        if self._comments_pane is None:
            return
        note_id = self._current_note_id()
        comments = (
            await fetch_comments(self._http_base_url, note_id, self._access_token)
            if note_id is not None and self._http_base_url is not None
            else []
        )
        self._comments_pane.set_comments(comments)

    async def _refresh_mentions(self) -> None:
        if self._mentions_pane is None:
            return
        mentions = (
            await fetch_mentions(self._http_base_url, self._access_token)
            if self._http_base_url is not None
            else []
        )
        self._mentions_pane.set_mentions(mentions)

    async def _refresh_trash(self) -> None:
        if self._trash_pane is None:
            return
        notes = (
            await fetch_trash(self._http_base_url, self._access_token)
            if self._http_base_url is not None
            else []
        )
        self._trash_pane.set_notes(notes)

    async def on_trash_pane_restore_requested(self, message: TrashPane.RestoreRequested) -> None:
        """`R` in the trash pane restores the note (T-016 / upgrades `R`)."""
        if self._http_base_url is None:
            return
        await restore_note(self._http_base_url, message.note_id, self._access_token)
        await self._refresh_trash()
        await self._refresh_notes()

    async def on_trash_pane_delete_forever_requested(
        self, message: TrashPane.DeleteForeverRequested
    ) -> None:
        """`D` in the trash pane hard-deletes the note."""
        if self._http_base_url is None:
            return
        await delete_note_forever(self._http_base_url, message.note_id, self._access_token)
        await self._refresh_trash()

    async def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        """Route a selection: a notes-list row or backlink row opens a note;
        a tag-picker row applies (or toggles off) that tag filter."""
        if self._tag_picker is not None and event.option_list is self._tag_picker:
            tag = event.option.id
            if tag is not None:
                self._apply_tag_filter(tag)
            return
        if self._mentions_pane is not None and event.option_list is self._mentions_pane:
            await self._open_mention(event.option.id)
            return
        if self._snapshots_pane is not None and event.option_list is self._snapshots_pane:
            self._confirm_restore_snapshot(event.option.id)
            return
        opens_note = event.option_list is self._notes_view or (
            event.option_list is self._backlinks_pane
        )
        if opens_note:
            note_id = event.option.id
            if note_id is not None:
                await self.open_note(note_id)

    async def _open_mention(self, mention_id: str | None) -> None:
        """T-017: mark the mention read, refresh the inbox, open its note."""
        if mention_id is None or self._mentions_pane is None:
            return
        mention = self._mentions_pane.mention_for(mention_id)
        if mention is None:
            return
        if self._http_base_url is not None:
            await mark_mention_read(self._http_base_url, mention_id, self._access_token)
            await self._refresh_mentions()
        await self.open_note(mention.note_id)

    def _confirm_restore_snapshot(self, snapshot_id: str | None) -> None:
        """T-015: Enter on a snapshot confirms, then restores it via the server.

        The server writes a pre-restore auto-snapshot and applies the snapshot's
        Yjs state to the live doc (C-006); the new content reaches the editor
        through normal collab sync.
        """
        note_id = self._current_note_id()
        if snapshot_id is None or note_id is None or self._http_base_url is None:
            return

        def _confirm(ok: bool | None) -> None:
            if ok:
                self.run_worker(self._restore_snapshot(note_id, snapshot_id))

        self.push_screen(ConfirmModal("Restore this snapshot?"), _confirm)

    async def _restore_snapshot(self, note_id: str, snapshot_id: str) -> None:
        assert self._http_base_url is not None
        await restore_snapshot(self._http_base_url, note_id, snapshot_id, self._access_token)

    # ----------------------------------------------------------- T-013/T-014 comments

    def on_comments_pane_new_comment_requested(
        self, _message: CommentsPane.NewCommentRequested
    ) -> None:
        """`c`: compose a new top-level comment on the current note."""
        note_id = self._current_note_id()
        if note_id is None or self._http_base_url is None:
            return

        def _submit(body: str | None) -> None:
            if body:
                self.run_worker(self._create_comment(note_id, body))

        self.push_screen(TextInputModal("New comment", "comment…"), _submit)

    async def _create_comment(self, note_id: str, body: str) -> None:
        assert self._http_base_url is not None
        await create_comment(self._http_base_url, note_id, body, self._access_token)
        await self._refresh_comments()

    def on_comments_pane_reply_requested(self, message: CommentsPane.ReplyRequested) -> None:
        """`r`: reply to the highlighted thread."""
        if self._http_base_url is None:
            return
        comment_id = message.comment_id

        def _submit(body: str | None) -> None:
            if body:
                self.run_worker(self._reply_comment(comment_id, body))

        self.push_screen(TextInputModal("Reply", "reply…"), _submit)

    async def _reply_comment(self, comment_id: str, body: str) -> None:
        assert self._http_base_url is not None
        await reply_comment(self._http_base_url, comment_id, body, self._access_token)
        if self._comments_pane is not None:
            self._comments_pane.expand(comment_id)  # show the new reply
        await self._refresh_comments()

    async def on_comments_pane_resolve_requested(
        self, message: CommentsPane.ResolveRequested
    ) -> None:
        """`x`: resolve the highlighted thread."""
        if self._http_base_url is None:
            return
        await resolve_comment(self._http_base_url, message.comment_id, self._access_token)
        await self._refresh_comments()

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
        if self._searching:
            return
        if self._active_tag is not None:
            self._notes_view.set_notes(self._notes_for_tag(self._active_tag))
        else:
            self._notes_view.set_notes(notes)

    def _notes_for_tag(self, tag: str) -> list[Note]:
        return [note for note in self._all_notes if tag in note.tags]

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

    # -------------------------------------------------------------- T-009 tag filter

    def on_structured_editor_tag_filter_requested(
        self, _message: StructuredEditor.TagFilterRequested
    ) -> None:
        """`t` in the editor's normal mode opens the tag picker."""
        self._open_tag_filter()

    def _open_tag_filter(self) -> None:
        if self._tag_picker is None:
            return
        tags = sorted({tag for note in self._all_notes for tag in note.tags})
        self._tag_picker.clear_options()
        for tag in tags:
            self._tag_picker.add_option(Option(tag, id=tag))
        self._tag_picker.add_class("filtering")
        self._tag_picker.focus()

    def _apply_tag_filter(self, tag: str) -> None:
        """Filter the list to ``tag``; selecting the active tag again clears it."""
        if self._active_tag == tag:
            self._active_tag = None
        else:
            self._active_tag = tag
        if self._notes_view is not None:
            visible = self._notes_for_tag(tag) if self._active_tag is not None else self._all_notes
            self._notes_view.set_notes(visible)
        self._close_tag_filter()

    def on_tag_picker_cancelled(self, _message: TagPicker.Cancelled) -> None:
        """Esc in the tag picker just dismisses it (keeps any active filter)."""
        self._close_tag_filter()

    def _close_tag_filter(self) -> None:
        if self._tag_picker is not None:
            self._tag_picker.remove_class("filtering")
        if self._editor is not None:
            self._editor.focus()

    # ------------------------------------------------------------------ T-010 CRUD

    def _current_note_id(self) -> str | None:
        """The note id the editor is on, parsed from the ``note:<id>`` room."""
        prefix = "note:"
        if self._doc_name.startswith(prefix):
            return self._doc_name[len(prefix) :]
        return None

    def _title_of(self, note_id: str) -> str:
        for note in self._all_notes:
            if note.id == note_id:
                return note.title
        return ""

    async def on_structured_editor_new_note_requested(
        self, _message: StructuredEditor.NewNoteRequested
    ) -> None:
        """`n`: create a note and open it."""
        if self._http_base_url is None:
            return
        note_id = await create_note(self._http_base_url, "Untitled", self._access_token)
        await self._refresh_notes()
        await self.open_note(note_id)

    def on_structured_editor_rename_requested(
        self, _message: StructuredEditor.RenameRequested
    ) -> None:
        """`r`: prompt for a new title and PATCH the current note."""
        note_id = self._current_note_id()
        if note_id is None or self._http_base_url is None:
            return

        def _apply(new_title: str | None) -> None:
            if new_title:
                self.run_worker(self._rename_and_refresh(note_id, new_title))

        self.push_screen(RenameModal(self._title_of(note_id)), _apply)

    async def _rename_and_refresh(self, note_id: str, title: str) -> None:
        assert self._http_base_url is not None
        await rename_note(self._http_base_url, note_id, title, self._access_token)
        await self._refresh_notes()

    def on_structured_editor_delete_requested(
        self, _message: StructuredEditor.DeleteRequested
    ) -> None:
        """`d`: confirm, then soft-delete the current note (remember it for `R`)."""
        note_id = self._current_note_id()
        if note_id is None or self._http_base_url is None:
            return

        def _confirm(ok: bool | None) -> None:
            if ok:
                self.run_worker(self._delete_and_refresh(note_id))

        self.push_screen(ConfirmModal("Delete this note?"), _confirm)

    async def _delete_and_refresh(self, note_id: str) -> None:
        assert self._http_base_url is not None
        await delete_note(self._http_base_url, note_id, self._access_token)
        self._last_deleted = note_id
        await self._refresh_notes()

    async def on_structured_editor_restore_requested(
        self, _message: StructuredEditor.RestoreRequested
    ) -> None:
        """`R`: restore the most recently deleted note and reopen it."""
        if self._last_deleted is None or self._http_base_url is None:
            return
        restored = self._last_deleted
        await restore_note(self._http_base_url, restored, self._access_token)
        self._last_deleted = None
        await self._refresh_notes()
        await self.open_note(restored)

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

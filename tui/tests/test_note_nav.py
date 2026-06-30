"""TUI note navigation (foundation for T-008/T-010/T-011): opening a note from
the list switches the editor to that note's Hocuspocus room + document.

The local-mode tests (``connect_on_mount=False``) swap the document without a
server, so they run locally. The reconnect path is exercised by the
CI-gated integration test at the bottom (it opens a live websocket, which
deadlocks in the headless sandbox).
"""

from __future__ import annotations

import asyncio

import pytest
import y_py as Y
from textual.app import App, ComposeResult

from bartleby_tui.app import BartlebyApp
from bartleby_tui.connection import HocuspocusConnection
from bartleby_tui.editor import StructuredEditor
from bartleby_tui.notes_api import Note
from bartleby_tui.renderer import ydoc_to_blocks

pytestmark = pytest.mark.asyncio


class _EditorHost(App[None]):
    def __init__(self, doc: Y.YDoc) -> None:
        super().__init__()
        self.editor = StructuredEditor(doc, id="editor")

    def compose(self) -> ComposeResult:
        yield self.editor

    def on_mount(self) -> None:
        self.editor.focus()


def _fragment_text(doc: Y.YDoc) -> str:
    parts: list[str] = []
    for block in ydoc_to_blocks(doc):
        parts.append("".join(i.text for i in block.inlines))
    return " ".join(p for p in parts if p)


# --------------------------------------------------------------- set_doc


async def test_set_doc_swaps_editor_document() -> None:
    first = Y.YDoc()
    host = _EditorHost(first)
    async with host.run_test() as pilot:
        await pilot.press("a", "b")
        await pilot.pause()
        assert _fragment_text(first) == "ab"

        second = Y.YDoc()
        host.editor.set_doc(second)
        await pilot.press("x", "y")
        await pilot.pause()

    assert _fragment_text(second) == "xy"
    assert _fragment_text(first) == "ab"  # old doc untouched
    assert host.editor.caret == ((0,), 2)  # caret reset then advanced by "xy"


# --------------------------------------------------------------- open_note (local)


async def test_open_note_switches_room_and_document() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-123")
        await pilot.pause()

        assert app._doc_name == "note-123"
        # Typing now lands in the new note's document.
        await pilot.press("h", "i")
        await pilot.pause()
        assert _fragment_text(app._doc) == "hi"


async def test_open_note_is_noop_for_current_note() -> None:
    app = BartlebyApp(connect_on_mount=False, doc_name="abc")
    async with app.run_test() as pilot:
        await pilot.pause()
        doc_before = app._doc
        await app.open_note("abc")
        await pilot.pause()
        assert app._doc is doc_before  # unchanged — same note


async def test_selecting_a_note_row_opens_it() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app._notes_view is not None
        app._notes_view.set_notes(
            [
                Note(id="n1", title="alpha", tags=(), updated_at="2026-01-01T00:00:00Z"),
                Note(id="n2", title="beta", tags=(), updated_at="2026-01-01T00:00:00Z"),
            ]
        )
        await pilot.pause()
        app._notes_view.focus()
        app._notes_view.highlighted = 0  # highlight the first row
        await pilot.press("enter")  # select it
        await pilot.pause()

        assert app._doc_name == "n1"


# --------------------------------------------------------------- reconnect (CI)


async def test_open_note_loads_remote_content(hocuspocus_server: str) -> None:
    """Opening a note reconnects to its room and renders existing content."""
    note_id = f"nav-{id(object())}"
    room = f"{note_id}"

    # Pre-seed the note's room with content via a separate peer.
    seed_doc = Y.YDoc()
    async with HocuspocusConnection(
        url=hocuspocus_server, doc_name=room, document=seed_doc
    ) as seed:
        await asyncio.wait_for(seed.wait_synced(), timeout=5.0)
        xml = seed_doc.get_xml_element("prosemirror")
        with seed_doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            p = xml.push_xml_element(txn, "paragraph")
            p.push_xml_text(txn).push(txn, "seeded note body")

        app = BartlebyApp(server_url=hocuspocus_server, doc_name="vertical-slice")
        async with app.run_test() as pilot:
            await pilot.pause()
            await app.open_note(note_id)
            for _ in range(80):
                if "seeded note body" in _fragment_text(app._doc):
                    break
                await pilot.pause(0.05)
            assert "seeded note body" in _fragment_text(app._doc)

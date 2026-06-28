"""T-004 / T-006 acceptance (app integration): the document is rendered in the
editor pane and re-renders whenever the YDoc prosemirror fragment changes.

The pure-renderer unit tests in ``test_renderer.py`` already cover one
snapshot per node type. These tests verify the editor widget is wired up to
YDoc updates. As of T-006 the editable ``StructuredEditor`` replaced the
read-only ``DocumentRenderer``; it renders the same document (via the shared
``render_document``) plus a caret, so these assertions now target ``#editor``.
"""

from __future__ import annotations

import pytest
import y_py as Y
from rich.console import Console

from bartleby_tui.app import BartlebyApp
from bartleby_tui.editor import StructuredEditor

pytestmark = pytest.mark.asyncio


def _editor_plain_text(editor: StructuredEditor) -> str:
    console = Console(file=None, width=120, record=True)
    console.print(editor.content, end="")
    return console.export_text(clear=True)


async def test_editor_pane_contains_structured_editor() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()

        editor = app.query_one("#editor", StructuredEditor)
        assert editor is not None


async def test_editor_updates_when_prosemirror_fragment_changes() -> None:
    """Editing the YDoc's prosemirror fragment should re-render the editor."""
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()

        # Directly mutate the YDoc's prosemirror fragment (simulates a
        # peer's update arriving). Use the app's internal YDoc handle.
        doc = app._doc
        xml = doc.get_xml_element("prosemirror")
        with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            p = xml.push_xml_element(txn, "paragraph")
            p.push_xml_text(txn).push(txn, "from peer")

        # Manually invoke the refresh path; in the live app this is plumbed
        # via the connection callback, but with connect_on_mount=False there
        # is no connection — call directly to exercise the widget wiring.
        editor = app.query_one("#editor", StructuredEditor)
        editor.refresh_view()
        await pilot.pause()

        assert "from peer" in _editor_plain_text(editor)


async def test_layout_test_still_finds_three_panes() -> None:
    """T-001 layout invariant: the three named regions are still present."""
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()

        assert app.query_one("#notes-pane") is not None
        assert app.query_one("#editor-pane") is not None
        assert app.query_one("#status-bar") is not None


async def test_remote_prosemirror_update_repaints_editor(
    hocuspocus_server: str,
) -> None:
    """A remote peer mutating the prosemirror fragment should repaint the
    TUI's editor pane via the connection callback.
    """
    from bartleby_tui.connection import HocuspocusConnection

    room = f"app-editor-{id(object())}"
    app = BartlebyApp(server_url=hocuspocus_server, doc_name=room)
    async with app.run_test() as pilot:
        await pilot.pause()
        for _ in range(50):
            if app.connection is not None and app.connection.is_synced:
                break
            await pilot.pause(0.05)
        assert app.connection is not None and app.connection.is_synced

        remote_doc = Y.YDoc()
        async with HocuspocusConnection(
            url=hocuspocus_server,
            doc_name=room,
            document=remote_doc,
        ) as remote:
            import asyncio

            await asyncio.wait_for(remote.wait_synced(), timeout=5.0)

            xml = remote_doc.get_xml_element("prosemirror")
            with remote_doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
                p = xml.push_xml_element(txn, "paragraph")
                p.push_xml_text(txn).push(txn, "remote hi from prosemirror")

            editor = app.query_one("#editor", StructuredEditor)
            for _ in range(50):
                if "remote hi from prosemirror" in _editor_plain_text(editor):
                    break
                await pilot.pause(0.05)

        assert "remote hi from prosemirror" in _editor_plain_text(editor)

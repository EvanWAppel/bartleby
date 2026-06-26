"""T-004 acceptance (app integration): the DocumentRenderer widget exists
in the editor pane and re-renders whenever the YDoc prosemirror fragment
changes.

The pure-renderer unit tests in ``test_renderer.py`` already cover one
snapshot per node type. These tests verify the widget is wired up to
YDoc updates without breaking the existing TextArea-driven editing
path.
"""

from __future__ import annotations

import pytest
import y_py as Y

from bartleby_tui.app import BartlebyApp, DocumentRenderer

pytestmark = pytest.mark.asyncio


async def test_editor_pane_contains_document_renderer_widget() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()

        renderer = app.query_one("#document", DocumentRenderer)
        assert renderer is not None


async def test_renderer_updates_when_prosemirror_fragment_changes() -> None:
    """Editing the YDoc's prosemirror fragment should re-render the widget."""
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

        # Manually invoke the refresh path; T-004 plumbs this via the
        # connection callback, but with connect_on_mount=False there is
        # no connection — directly call to exercise widget wiring.
        app._refresh_renderer()
        await pilot.pause()

        renderer = app.query_one("#document", DocumentRenderer)
        # Stringify the renderable to a flat str; we read .content (the
        # original Rich renderable handed to Static.update).
        from rich.console import Console

        console = Console(file=None, width=120, record=True)
        console.print(renderer.content, end="")
        plain = console.export_text(clear=True)
        assert "from peer" in plain


async def test_layout_test_still_finds_three_panes() -> None:
    """T-001 layout invariant: the three named regions are still present
    after T-004 added the DocumentRenderer inside #editor-pane.
    """
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()

        assert app.query_one("#notes-pane") is not None
        assert app.query_one("#editor-pane") is not None
        assert app.query_one("#status-bar") is not None


async def test_remote_prosemirror_update_repaints_renderer(
    hocuspocus_server: str,
) -> None:
    """A remote peer mutating the prosemirror fragment should repaint
    the TUI's renderer pane via the connection callback.
    """
    from bartleby_tui.connection import HocuspocusConnection

    room = f"app-renderer-{id(object())}"
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

            renderer = app.query_one("#document", DocumentRenderer)
            from rich.console import Console

            for _ in range(50):
                console = Console(file=None, width=120, record=True)
                console.print(renderer.content, end="")
                plain = console.export_text(clear=True)
                if "remote hi from prosemirror" in plain:
                    break
                await pilot.pause(0.05)

        console = Console(file=None, width=120, record=True)
        console.print(renderer.content, end="")
        plain = console.export_text(clear=True)
        assert "remote hi from prosemirror" in plain

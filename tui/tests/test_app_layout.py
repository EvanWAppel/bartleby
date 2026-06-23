"""T-001 acceptance: three-pane app skeleton.

Pilot snapshot of layout regions — confirms the Notes pane (left), Editor
pane (main), and StatusBar (bottom) exist with stable ids and have a
sensible bounding-box layout. Subsequent T-tasks (T-007 notes-list, T-004
renderer, T-018 status-bar wiring) will populate these regions; T-001 only
owns the structural skeleton.
"""

from __future__ import annotations

import pytest

from bartleby_tui.app import BartlebyApp

pytestmark = pytest.mark.asyncio


async def test_skeleton_has_three_named_regions() -> None:
    """The app composes a notes pane, editor pane, and status bar by id."""
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()

        notes = app.query_one("#notes-pane")
        editor = app.query_one("#editor-pane")
        status = app.query_one("#status-bar")

        assert notes is not None
        assert editor is not None
        assert status is not None


async def test_skeleton_layout_geometry() -> None:
    """Notes pane is to the left of editor; status bar is below both."""
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()

        notes = app.query_one("#notes-pane")
        editor = app.query_one("#editor-pane")
        status = app.query_one("#status-bar")

        notes_region = notes.region
        editor_region = editor.region
        status_region = status.region

        # Notes pane is left of the editor pane (horizontal split).
        assert notes_region.x < editor_region.x
        assert notes_region.right <= editor_region.x

        # Editor pane is wider than notes pane (main content area).
        assert editor_region.width > notes_region.width

        # Status bar sits below both panes.
        assert status_region.y >= notes_region.bottom
        assert status_region.y >= editor_region.bottom

        # Status bar spans the full app width (roughly).
        assert status_region.width >= notes_region.width + editor_region.width - 1


async def test_skeleton_does_not_require_server_connection() -> None:
    """The skeleton mounts without a running Hocuspocus server.

    T-001 is about layout; later tasks wire up live connections. Mounting
    must not block on or fail because the server is absent.
    """
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.connection is None

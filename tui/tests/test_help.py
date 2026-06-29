"""T-020: `?` opens a scrollable keybind reference; Esc dismisses it."""

from __future__ import annotations

import pytest
from textual.containers import VerticalScroll

from bartleby_tui.app import BartlebyApp
from bartleby_tui.modals import HelpModal

pytestmark = pytest.mark.asyncio


async def _open_help(pilot, app: BartlebyApp) -> None:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")  # normal mode
    await pilot.press("question_mark")  # `?`
    await pilot.pause()


async def test_question_opens_help_overlay() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        await _open_help(pilot, app)
        assert isinstance(app.screen, HelpModal)


async def test_help_lists_keybindings() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        await _open_help(pilot, app)
        from rich.console import Console

        body = app.screen.query_one("#help-body")
        console = Console(width=100, record=True)
        console.print(body.render(), end="")
        text = console.export_text()
        for needle in ("search", "bold", "new", "follow [[backlink]]", "tag filter"):
            assert needle in text


async def test_help_is_scrollable_and_scrolls() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        await _open_help(pilot, app)
        scroll = app.screen.query_one("#help-scroll", VerticalScroll)
        assert scroll.max_scroll_y > 0  # content taller than the overlay

        scroll.scroll_end(animate=False)
        await pilot.pause()
        assert scroll.scroll_offset.y > 0


async def test_escape_dismisses_help() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        await _open_help(pilot, app)
        assert isinstance(app.screen, HelpModal)

        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, HelpModal)

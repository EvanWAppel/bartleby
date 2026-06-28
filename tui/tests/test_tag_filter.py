"""T-009: `t` opens a tag picker; selecting a tag filters the notes list,
selecting it again clears the filter.

Filtering is local (tags already live on the cached ``Note`` rows), so these
mount the full app with ``connect_on_mount=False`` and run in the sandbox.
"""

from __future__ import annotations

import pytest

from bartleby_tui.app import BartlebyApp, TagPicker
from bartleby_tui.notes_api import Note
from bartleby_tui.notes_list import NotesList

pytestmark = pytest.mark.asyncio

_TS = "2030-01-01T00:00:00.000Z"
_NOTES = [
    Note(id="a", title="alpha", tags=("work", "urgent"), updated_at=_TS),
    Note(id="b", title="beta", tags=("home",), updated_at=_TS),
    Note(id="c", title="gamma", tags=("work",), updated_at=_TS),
]


def _seed(app: BartlebyApp) -> None:
    app._all_notes = list(_NOTES)
    assert app._notes_view is not None
    app._notes_view.set_notes(_NOTES)


def _picker_tags(picker: TagPicker) -> list[str]:
    return [
        str(picker.get_option_at_index(i).id)
        for i in range(picker.option_count)
        if picker.get_option_at_index(i).id is not None
    ]


async def _select_tag(pilot, picker: TagPicker, tag: str) -> None:
    picker.focus()
    picker.highlighted = _picker_tags(picker).index(tag)
    await pilot.press("enter")
    await pilot.pause()


async def test_t_opens_tag_picker_with_unique_sorted_tags() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        _seed(app)
        picker = app.query_one("#tag-picker", TagPicker)
        assert not picker.has_class("filtering")

        await pilot.press("escape")  # editor → normal mode
        await pilot.press("t")
        await pilot.pause()

        assert picker.has_class("filtering")
        assert _picker_tags(picker) == ["home", "urgent", "work"]


async def test_selecting_tag_filters_list() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        _seed(app)
        notes = app.query_one("#notes-pane", NotesList)
        picker = app.query_one("#tag-picker", TagPicker)

        await pilot.press("escape")
        await pilot.press("t")
        await pilot.pause()
        await _select_tag(pilot, picker, "work")

        assert {n.id for n in notes.notes} == {"a", "c"}
        assert app._active_tag == "work"
        assert not picker.has_class("filtering")  # picker dismissed after pick


async def test_selecting_active_tag_again_clears_filter() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        _seed(app)
        notes = app.query_one("#notes-pane", NotesList)
        picker = app.query_one("#tag-picker", TagPicker)

        await pilot.press("escape")
        await pilot.press("t")
        await pilot.pause()
        await _select_tag(pilot, picker, "work")
        assert notes.option_count == 2

        # Re-open and pick "work" again → clears.
        await pilot.press("t")
        await pilot.pause()
        await _select_tag(pilot, picker, "work")

        assert app._active_tag is None
        assert notes.option_count == 3  # full list restored


async def test_escape_dismisses_picker() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        _seed(app)
        picker = app.query_one("#tag-picker", TagPicker)

        await pilot.press("escape")
        await pilot.press("t")
        await pilot.pause()
        assert picker.has_class("filtering")

        picker.focus()
        await pilot.press("escape")
        await pilot.pause()
        assert not picker.has_class("filtering")

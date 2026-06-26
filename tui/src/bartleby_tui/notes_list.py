"""Notes list widget (T-007).

Renders one row per note inside the left ``#notes-pane``. Each row shows
the title (truncated), tag chips, and a relative "updated" timestamp.
The widget is data-driven: ``set_notes(...)`` is the only public mutator;
the surrounding app's polling loop calls it on every refresh.

Built on ``OptionList`` because it gives us:
- selectable rows out of the box (``OptionList.OptionSelected`` message),
- stable ids per option (we use the note id), and
- a small enough API surface to test without a Pilot.

T-008 (search) and T-009 (tag filter) will reuse this widget and just
pass it a filtered list.
"""

from __future__ import annotations

from datetime import UTC, datetime

from textual.widgets import OptionList
from textual.widgets.option_list import Option

from bartleby_tui.notes_api import Note

TITLE_MAX = 32


class NotesList(OptionList):
    """Live list of notes. One ``Option`` per note, id == note id."""

    DEFAULT_CSS = """
    NotesList {
        height: 1fr;
        padding: 0;
    }
    """

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._notes: tuple[Note, ...] = ()

    @property
    def notes(self) -> tuple[Note, ...]:
        """Most recently set notes list. Useful for assertions."""
        return self._notes

    def set_notes(
        self,
        notes: list[Note] | tuple[Note, ...],
        *,
        now: datetime | None = None,
    ) -> None:
        """Replace the rendered rows.

        We diff on the (id, title, tags, updated_at) tuple — if the list
        hasn't changed we avoid touching the widget so the user's current
        selection / scroll position stays put.
        """
        next_tuple = tuple(notes)
        if next_tuple == self._notes:
            return
        self._notes = next_tuple
        self.clear_options()
        when = now if now is not None else datetime.now(UTC)
        new_options = [_render_option(n, now=when) for n in next_tuple]
        if new_options:
            self.add_options(new_options)


def _render_option(note: Note, *, now: datetime) -> Option:
    """Render one note as an OptionList option.

    The visible prompt is plain text — no Rich markup — so tests can
    grep for substrings without de-escaping ANSI/markup.
    """
    title = _truncate(note.title, TITLE_MAX)
    tags_part = " " + " ".join(f"#{t}" for t in note.tags) if note.tags else ""
    updated_part = " · " + _relative_time(note.updated_at, now=now)
    prompt = f"{title}{tags_part}{updated_part}"
    return Option(prompt, id=note.id)


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _relative_time(iso: str, *, now: datetime) -> str:
    """Render an ISO timestamp as e.g. "5m", "3h", "2d", or the date.

    We accept either an offset-aware ISO string or a naive UTC one (the
    server emits UTC ISO8601 with a 'Z'). Errors propagate per agents.md.
    """
    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    delta_seconds = (now - parsed).total_seconds()
    if delta_seconds < 0:
        return "just now"
    if delta_seconds < 60:
        return f"{int(delta_seconds)}s ago"
    if delta_seconds < 3600:
        return f"{int(delta_seconds // 60)}m ago"
    if delta_seconds < 86400:
        return f"{int(delta_seconds // 3600)}h ago"
    if delta_seconds < 86400 * 30:
        return f"{int(delta_seconds // 86400)}d ago"
    return parsed.date().isoformat()

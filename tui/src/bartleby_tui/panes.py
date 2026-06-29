"""Right-pane widgets (Workstream T pane cluster).

``BacklinksPane`` (T-012) lists the notes that link to the current note; the
app toggles it with the ``g b`` chord and selecting a row opens the source.
Later panes (comments, history, …) join this module.
"""

from __future__ import annotations

from textual import events
from textual.message import Message
from textual.widgets import OptionList
from textual.widgets.option_list import Option

from bartleby_tui.notes_api import Backlink, Note


class BacklinksPane(OptionList):
    """Inbound-links list. One row per source note; option id == source id."""

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._backlinks: tuple[Backlink, ...] = ()

    @property
    def backlinks(self) -> tuple[Backlink, ...]:
        return self._backlinks

    def set_backlinks(self, backlinks: list[Backlink] | tuple[Backlink, ...]) -> None:
        """Replace the rendered inbound links."""
        self._backlinks = tuple(backlinks)
        self.clear_options()
        for link in self._backlinks:
            title = link.source_title or "(untitled)"
            self.add_option(Option(title, id=link.source_id))


class TrashPane(OptionList):
    """Trashed-notes list (T-016). ``R`` restores, ``D`` deletes forever."""

    class RestoreRequested(Message):
        def __init__(self, note_id: str) -> None:
            super().__init__()
            self.note_id = note_id

    class DeleteForeverRequested(Message):
        def __init__(self, note_id: str) -> None:
            super().__init__()
            self.note_id = note_id

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._notes: tuple[Note, ...] = ()

    @property
    def notes(self) -> tuple[Note, ...]:
        return self._notes

    def set_notes(self, notes: list[Note] | tuple[Note, ...]) -> None:
        self._notes = tuple(notes)
        self.clear_options()
        for note in self._notes:
            self.add_option(Option(note.title or "(untitled)", id=note.id))

    def _highlighted_id(self) -> str | None:
        if self.highlighted is None:
            return None
        return self.get_option_at_index(self.highlighted).id

    def on_key(self, event: events.Key) -> None:
        # Shift-R / Shift-D act on the highlighted trashed note.
        if event.key == "R":
            note_id = self._highlighted_id()
            if note_id is not None:
                event.stop()
                event.prevent_default()
                self.post_message(self.RestoreRequested(note_id))
        elif event.key == "D":
            note_id = self._highlighted_id()
            if note_id is not None:
                event.stop()
                event.prevent_default()
                self.post_message(self.DeleteForeverRequested(note_id))

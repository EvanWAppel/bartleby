"""Right-pane widgets (Workstream T pane cluster).

``BacklinksPane`` (T-012) lists the notes that link to the current note; the
app toggles it with the ``g b`` chord and selecting a row opens the source.
Later panes (comments, history, …) join this module.
"""

from __future__ import annotations

from textual.widgets import OptionList
from textual.widgets.option_list import Option

from bartleby_tui.notes_api import Backlink


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

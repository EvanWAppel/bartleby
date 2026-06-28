"""Modal dialogs for note CRUD (T-010).

``RenameModal`` collects a new title (returns the string, or ``None`` on
cancel). ``ConfirmModal`` is a yes/no gate (returns ``bool``). Both are
``ModalScreen`` subclasses driven with ``App.push_screen_wait`` so the caller
can ``await`` the result inline.
"""

from __future__ import annotations

from textual import events
from textual.app import ComposeResult
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import Input, Label


class RenameModal(ModalScreen[str | None]):
    """Prompt for a new note title. Enter submits, Esc cancels (returns None)."""

    DEFAULT_CSS = """
    RenameModal {
        align: center middle;
    }
    #rename-dialog {
        width: 50;
        height: auto;
        padding: 1 2;
        border: round $primary;
        background: $surface;
    }
    """

    def __init__(self, current_title: str = "") -> None:
        super().__init__()
        self._current_title = current_title

    def compose(self) -> ComposeResult:
        with Vertical(id="rename-dialog"):
            yield Label("Rename note")
            yield Input(value=self._current_title, id="rename-input")

    def on_mount(self) -> None:
        self.query_one("#rename-input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        event.stop()
        self.dismiss(event.value)

    def on_key(self, event: events.Key) -> None:
        if event.key == "escape":
            event.stop()
            event.prevent_default()
            self.dismiss(None)


class ConfirmModal(ModalScreen[bool]):
    """Yes/no confirmation. ``y``/Enter → True, ``n``/Esc → False."""

    DEFAULT_CSS = """
    ConfirmModal {
        align: center middle;
    }
    #confirm-dialog {
        width: 50;
        height: auto;
        padding: 1 2;
        border: round $primary;
        background: $surface;
    }
    #confirm-hint {
        color: $text-muted;
    }
    """

    def __init__(self, prompt: str) -> None:
        super().__init__()
        self._prompt = prompt

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-dialog"):
            yield Label(self._prompt)
            yield Label("[y] yes    [n] no", id="confirm-hint")

    def on_key(self, event: events.Key) -> None:
        if event.key in ("y", "enter"):
            event.stop()
            event.prevent_default()
            self.dismiss(True)
        elif event.key in ("n", "escape"):
            event.stop()
            event.prevent_default()
            self.dismiss(False)

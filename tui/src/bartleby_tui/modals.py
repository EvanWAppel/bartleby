"""Modal dialogs.

``RenameModal`` collects a new title (returns the string, or ``None`` on
cancel) and ``ConfirmModal`` is a yes/no gate (returns ``bool``) — both T-010,
driven via ``push_screen(..., callback)``. ``HelpModal`` (T-020) is a
scrollable keybind reference, dismissed with ``Esc``/``?``.
"""

from __future__ import annotations

from rich.text import Text
from textual import events
from textual.app import ComposeResult
from textual.containers import Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Input, Label, Static


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


#: T-020 keybind reference: (section title, [(keys, description), ...]).
HELP_SECTIONS: list[tuple[str, list[tuple[str, str]]]] = [
    ("Modes", [("Esc", "normal mode"), ("i", "insert mode")]),
    (
        "Marks",
        [("Ctrl-B", "bold"), ("Ctrl-I", "italic"), ("Ctrl-X", "strike"), ("Ctrl-K", "link")],
    ),
    (
        "Blocks (insert, at line start)",
        [
            ("# / ## / ###", "heading 1/2/3"),
            ("- / 1.", "bullet / ordered list"),
            (">", "blockquote"),
            ("Space", "toggle task (at line start)"),
        ],
    ),
    (
        "Notes (normal)",
        [("n", "new"), ("r", "rename"), ("d", "delete"), ("R", "restore last deleted")],
    ),
    ("Navigate (normal)", [("Enter", "follow [[backlink]]")]),
    ("Find (normal)", [("/", "search"), ("t", "tag filter")]),
    ("App", [("?", "this help"), ("Ctrl-Q", "quit")]),
]


def _help_text() -> Text:
    text = Text()
    for i, (title, rows) in enumerate(HELP_SECTIONS):
        if i > 0:
            text.append("\n")
        text.append(f"{title}\n", style="bold underline")
        for keys, desc in rows:
            text.append("  ")
            text.append(f"{keys:<16}", style="bold cyan")
            text.append(f"{desc}\n")
    return text


class HelpModal(ModalScreen[None]):
    """Scrollable keybind reference (T-020). Dismissed with ``Esc`` or ``?``."""

    DEFAULT_CSS = """
    HelpModal {
        align: center middle;
    }
    #help-dialog {
        width: 60;
        height: 80%;
        padding: 1 2;
        border: round $primary;
        background: $surface;
    }
    #help-scroll {
        height: 1fr;
    }
    """

    def compose(self) -> ComposeResult:
        with Vertical(id="help-dialog"):
            yield Label("Keybindings  (Esc to close)", id="help-title")
            with VerticalScroll(id="help-scroll"):
                yield Static(_help_text(), id="help-body")

    def on_mount(self) -> None:
        # Focus the scroller so arrow / PageDown / End scroll the reference.
        self.query_one("#help-scroll", VerticalScroll).focus()

    def on_key(self, event: events.Key) -> None:
        # Only intercept the dismiss keys; scroll keys fall through to the
        # focused VerticalScroll (which handles them first as it bubbles up).
        if event.key in ("escape", "question_mark"):
            event.stop()
            event.prevent_default()
            self.dismiss(None)

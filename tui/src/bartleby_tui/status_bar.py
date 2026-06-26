"""Bottom-of-screen status bar (T-018).

Three logical regions packed into a single ``Static`` cell that lives in
``BartlebyApp.compose`` as ``#status-bar``:

* **Connection** (left): ``● live`` (green) when the websocket is open,
  ``○ offline`` (dim) otherwise. T-019 will extend this to ``○ offline —
  N pending`` once it owns the local edit queue; the API is already
  shaped to accept an optional pending count.

* **Presence** (middle): one entry per peer reported by Yjs awareness,
  plus a ``● you`` chip for our own client when we have a local user
  state. Each entry is rendered in the peer's color when their awareness
  state carries one; otherwise a neutral fallback (``white``) is used so
  T-024's per-user color work can come in independently and just start
  populating ``state['user']['color']``.

* **Hint** (right): short free-form text — most-recent key hint, error
  banner, etc. Empty by default for T-018; later tasks can call
  ``set_hint``.

We only ship "name" presence here; the spec example also shows ``L42``
line numbers but the T-018 acceptance is satisfied by *"presence updates
when another client joins"*, so we keep the cursor-line readout for a
later task (T-005 or follow-on).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from rich.text import Text
from textual.widgets import Static

#: Rich color string used when a peer's awareness state doesn't carry one.
#: T-024 will eventually plumb a real color through ``user.color`` and this
#: fallback should only matter for clients running pre-T-024 code paths.
FALLBACK_COLOR = "white"

#: Connection-status glyphs. Filled dot = live, open dot = offline.
LIVE_GLYPH = "●"
OFFLINE_GLYPH = "○"

#: Separator drawn between the three regions and between presence chips.
REGION_SEP = "  "
PEER_SEP = "  "


class StatusBar(Static):
    """Single-line status bar rendered as styled rich text.

    State is held on the widget and re-rendered through ``_refresh``; the
    app calls ``set_connected`` / ``set_peers`` / ``set_self`` /
    ``set_hint`` in response to the corresponding ``HocuspocusConnection``
    events.
    """

    DEFAULT_CSS = """
    StatusBar {
        dock: bottom;
        height: 1;
        background: $boost;
        color: $text;
        padding: 0 1;
    }
    """

    def __init__(self, id: str | None = "status-bar") -> None:
        super().__init__("", id=id)
        self._connected: bool = False
        self._pending: int = 0
        self._peers: dict[int, dict[str, Any]] = {}
        self._self_state: dict[str, Any] | None = None
        self._hint: str = ""

    # ----------------------------------------------------------- state setters

    def set_connected(self, connected: bool, *, pending: int = 0) -> None:
        """Update the connection indicator. ``pending`` is reserved for T-019."""
        self._connected = connected
        self._pending = pending
        self._refresh()

    def set_peers(self, peers: Mapping[int, Mapping[str, Any]]) -> None:
        """Replace the peer presence map (caller already filtered out self)."""
        self._peers = {cid: dict(state) for cid, state in peers.items()}
        self._refresh()

    def set_self(self, state: Mapping[str, Any] | None) -> None:
        """Set our own awareness state — used to color the ``● you`` chip."""
        self._self_state = dict(state) if state is not None else None
        self._refresh()

    def set_hint(self, hint: str) -> None:
        """Replace the right-aligned hint text."""
        self._hint = hint
        self._refresh()

    # ------------------------------------------------------------------ render

    def _refresh(self) -> None:
        self.update(self.render_status())

    def render_status(self) -> Text:
        """Build the rich ``Text`` shown in the status bar.

        Public so tests can assert on the rendered representation without
        coupling to Textual's internal render pipeline.
        """
        text = Text(no_wrap=True, overflow="ellipsis")
        self._render_connection(text)
        self._render_presence(text)
        if self._hint:
            text.append(REGION_SEP)
            text.append(self._hint, style="dim")
        return text

    def _render_connection(self, text: Text) -> None:
        if self._connected:
            text.append(LIVE_GLYPH, style="bold green")
            text.append(" live")
        else:
            text.append(OFFLINE_GLYPH, style="dim")
            text.append(" offline")
            # T-019 will populate _pending; until then it's always 0 and we
            # render the bare "offline" form to match the spec.
            if self._pending > 0:
                text.append(f" — {self._pending} pending", style="dim")

    def _render_presence(self, text: Text) -> None:
        chips: list[tuple[str, str]] = []
        if self._self_state is not None:
            chips.append(("you", _color_of(self._self_state)))
        for _, state in sorted(self._peers.items()):
            chips.append((_name_of(state), _color_of(state)))
        if not chips:
            return
        text.append(REGION_SEP)
        for i, (name, color) in enumerate(chips):
            if i > 0:
                text.append(PEER_SEP)
            text.append(LIVE_GLYPH, style=color)
            text.append(f" {name}")


def _name_of(state: Mapping[str, Any]) -> str:
    """Pull a display name out of an awareness state, with a safe fallback.

    Web clients publish ``{"user": {"name", "color"}}`` (see
    ``web/src/lib/Editor.svelte``). We mirror that shape but tolerate
    missing fields so a peer running an older client doesn't blank out
    the status bar.
    """
    user = state.get("user")
    if isinstance(user, Mapping):
        name = user.get("name")
        if isinstance(name, str) and name:
            return name
    return "anon"


def _color_of(state: Mapping[str, Any]) -> str:
    """Pull a rich color out of an awareness state, falling back to white.

    T-024 will assign per-user colors server-side and plumb them through
    ``user.color``; until that lands we render every peer in the fallback
    so they're still visually distinguishable from the connection glyph.
    """
    user = state.get("user")
    if isinstance(user, Mapping):
        color = user.get("color")
        if isinstance(color, str) and color:
            return color
    return FALLBACK_COLOR

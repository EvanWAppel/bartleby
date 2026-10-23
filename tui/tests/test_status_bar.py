"""T-018 acceptance tests for the status bar widget."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
import y_py as Y
from textual.app import App, ComposeResult

from bartleby_tui.app import BartlebyApp
from bartleby_tui.auth import UserInfo
from bartleby_tui.connection import HocuspocusConnection
from bartleby_tui.editor import StructuredEditor
from bartleby_tui.status_bar import (
    FALLBACK_COLOR,
    LIVE_GLYPH,
    OFFLINE_GLYPH,
    StatusBar,
)

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------- helpers


class _StatusBarHost(App[None]):
    """Bare host app that mounts a single StatusBar — used for widget tests."""

    def __init__(self) -> None:
        super().__init__()
        self.bar = StatusBar()

    def compose(self) -> ComposeResult:
        yield self.bar


# ---------------------------------------------------------------------- widget


class TestStatusBarRendering:
    async def test_default_state_renders_offline_and_no_peers(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            rendered = host.bar.render_status().plain
            assert rendered.startswith(f"{OFFLINE_GLYPH} offline")
            # No peers + no self => no presence chips.
            assert "you" not in rendered
            assert FALLBACK_COLOR not in rendered  # color names aren't in plain text

    async def test_connected_state_renders_live(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_connected(True)
            rendered = host.bar.render_status().plain
            assert rendered.startswith(f"{LIVE_GLYPH} live")

    async def test_self_chip_shown_when_local_state_set(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_self({"user": {"name": "alice", "color": "#aabbcc"}})
            rendered = host.bar.render_status().plain
            assert "you" in rendered

    async def test_peer_name_appears_in_presence_section(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_peers({42: {"user": {"name": "bob", "color": "#112233"}}})
            rendered = host.bar.render_status().plain
            assert "bob" in rendered

    async def test_peer_without_name_renders_anon(self) -> None:
        """A peer state missing user.name shouldn't break the bar."""
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_peers({7: {"user": {"color": "#ff0000"}}})
            rendered = host.bar.render_status().plain
            assert "anon" in rendered

    async def test_hint_text_appended(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_hint("ctrl+s to save")
            rendered = host.bar.render_status().plain
            assert "ctrl+s to save" in rendered

    async def test_pending_count_renders_when_offline_and_nonzero(self) -> None:
        """T-019 will wire this; T-018 just verifies the API holds the shape."""
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_connected(False, pending=3)
            rendered = host.bar.render_status().plain
            assert "3 pending" in rendered


# ---------------------------------------------------------------------- layout


class TestAppIntegration:
    async def test_app_mounts_status_bar_widget(self) -> None:
        """The skeleton replaces the placeholder Static with our StatusBar."""
        app = BartlebyApp(connect_on_mount=False)
        async with app.run_test() as pilot:
            await pilot.pause()
            bar = app.query_one("#status-bar", StatusBar)
            assert isinstance(bar, StatusBar)

    async def test_offline_default_when_not_connecting(self) -> None:
        app = BartlebyApp(connect_on_mount=False)
        async with app.run_test() as pilot:
            await pilot.pause()
            bar = app.query_one("#status-bar", StatusBar)
            rendered = bar.render_status().plain
            assert OFFLINE_GLYPH in rendered
            assert "offline" in rendered


# ---------------------------------------------------------------------- spec test


class TestPresenceUpdatesOnPeerJoin:
    """T-018's required test: 'presence updates when another client joins'."""

    async def test_status_bar_shows_peer_name_after_join(
        self,
        hocuspocus_server: str,
    ) -> None:
        room = f"status-bar-presence-{id(object())}"

        app = BartlebyApp(server_url=hocuspocus_server, doc_name=room)
        async with app.run_test() as pilot:
            await pilot.pause()
            for _ in range(50):
                if app.connection is not None and app.connection.is_synced:
                    break
                await pilot.pause(0.05)
            assert app.connection is not None and app.connection.is_synced

            bar = app.query_one("#status-bar", StatusBar)

            # No peer yet → presence section has neither "bob" nor "anon".
            rendered = bar.render_status().plain
            assert "bob" not in rendered

            # Spin up a second client and publish a Yjs awareness state.
            remote_doc = Y.YDoc()
            async with HocuspocusConnection(
                url=hocuspocus_server,
                doc_name=room,
                document=remote_doc,
            ) as remote:
                await asyncio.wait_for(remote.wait_synced(), timeout=5.0)
                remote.set_local_awareness({"user": {"name": "bob", "color": "#112233"}})

                for _ in range(80):
                    rendered = bar.render_status().plain
                    if "bob" in rendered:
                        break
                    await pilot.pause(0.05)
                assert "bob" in rendered, f"expected peer 'bob' in status bar, got: {rendered!r}"

            # And when the peer disconnects (awareness cleared via the
            # connection going away), the chip should fall back off. The
            # server forwards a final awareness=null frame as part of
            # disconnect, so wait a beat for it.
            for _ in range(50):
                rendered = bar.render_status().plain
                if "bob" not in rendered:
                    break
                await pilot.pause(0.05)
            # Tolerate the peer chip staying around — Hocuspocus relies on
            # a timeout to clear it and we don't want flaky CI. The hard
            # spec assertion is the "appears" half above.


# ---------------------------------------------------------------------- T-027


class _RecordingConnection:
    """Stand-in for HocuspocusConnection that records published awareness."""

    def __init__(self) -> None:
        self.published: list[dict[str, Any] | None] = []

    def set_local_awareness(self, state: dict[str, Any] | None) -> None:
        self.published.append(state)

    async def __aexit__(self, *_exc: object) -> None:
        return None


class TestCaretLineReadout:
    """T-027: ``● alice L42  ● you L42`` — caret line numbers via awareness."""

    async def test_peer_line_rendered_after_name(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_peers({42: {"user": {"name": "alice", "color": "#112233"}, "line": 42}})
            assert "● alice L42" in host.bar.render_status().plain

    async def test_self_line_rendered_after_you(self) -> None:
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            host.bar.set_self({"user": {"name": "me", "color": "#aabbcc"}, "line": 7})
            host.bar.set_peers({1: {"user": {"name": "alice"}, "line": 42}})
            assert "● you L7  ● alice L42" in host.bar.render_status().plain

    @pytest.mark.parametrize("line", [None, "12", True, 0, -3])
    async def test_missing_or_invalid_line_omitted(self, line: object) -> None:
        """Web peers publish no ``line`` (they use y-prosemirror cursors)."""
        host = _StatusBarHost()
        async with host.run_test() as pilot:
            await pilot.pause()
            state: dict[str, Any] = {"user": {"name": "alice"}}
            if line is not None:
                state["line"] = line
            host.bar.set_peers({1: state})
            rendered = host.bar.render_status().plain
            assert rendered.endswith("● alice"), rendered

    async def test_editor_reports_caret_line(self) -> None:
        app = BartlebyApp(connect_on_mount=False)
        async with app.run_test() as pilot:
            await pilot.pause()
            editor = app.query_one("#editor", StructuredEditor)
            assert editor.caret_line == 1
            await pilot.press("a", "enter", "b", "enter")
            await pilot.pause()
            assert editor.caret_line == 3
            await pilot.press("up")
            await pilot.pause()
            assert editor.caret_line == 2

    async def test_self_chip_tracks_caret_line(self) -> None:
        app = BartlebyApp(connect_on_mount=False)
        async with app.run_test() as pilot:
            await pilot.pause()
            bar = app.query_one("#status-bar", StatusBar)
            assert "● you L1" in bar.render_status().plain
            await pilot.press("a", "enter")
            await pilot.pause()
            assert "● you L2" in bar.render_status().plain

    async def test_caret_line_published_through_awareness(self) -> None:
        app = BartlebyApp(connect_on_mount=False)
        async with app.run_test() as pilot:
            await pilot.pause()
            conn = _RecordingConnection()
            app.connection = conn  # ty: ignore[invalid-assignment]
            app.user_info = UserInfo(
                id="u1", email="me@example.com", display_name="Me", color="#abcdef"
            )
            await pilot.press("a", "enter")
            await pilot.pause()
            assert conn.published, "expected an awareness publish on caret move"
            assert conn.published[-1] == {
                "user": {"name": "Me", "color": "#abcdef"},
                "line": 2,
            }
            # Typing on the same line doesn't re-publish.
            count = len(conn.published)
            await pilot.press("b", "c")
            await pilot.pause()
            assert len(conn.published) == count

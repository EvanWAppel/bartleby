"""T-017: `g i` opens a mentions inbox; selecting a mention marks it read and
navigates to the source note (unread count drops).

Mentions are HTTP (GET /mentions, POST /mentions/:id/read), so these mount the
full app with ``connect_on_mount=False`` + an in-process server — no websocket.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

import pytest

from bartleby_tui.app import BartlebyApp
from bartleby_tui.notes_api import fetch_mentions, mark_mention_read
from bartleby_tui.panes import MentionsPane

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    mentions: dict[str, dict[str, Any]] = field(default_factory=dict)

    def add(self, mention_id: str, note_id: str, title: str) -> None:
        self.mentions[mention_id] = {
            "id": mention_id,
            "note_id": note_id,
            "note_title": title,
            "source": "comment",
            "read_at": None,
        }


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            if urlparse(self.path).path == "/mentions":
                self._json(200, {"mentions": list(state.mentions.values())})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path.startswith("/mentions/") and path.endswith("/read"):
                mention_id = path.split("/")[2]
                if mention_id in state.mentions:
                    state.mentions[mention_id]["read_at"] = "2030-01-01T00:00:00.000Z"
                self._json(200, {})
            else:
                self._json(404, {"error": "not_found"})

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    state.base_url = f"http://127.0.0.1:{srv.server_port}"
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        srv.shutdown()
        srv.server_close()


async def _open_inbox(pilot, app: BartlebyApp) -> MentionsPane:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.press("g")
    await pilot.press("i")
    await pilot.pause()
    await pilot.pause()
    return app.query_one("#inbox-pane", MentionsPane)


# ----------------------------------------------------------------- api


async def test_fetch_and_mark_read(server: _Server) -> None:
    server.add("m1", "note-a", "Alpha")
    mentions = await fetch_mentions(server.base_url)
    assert [m.id for m in mentions] == ["m1"]
    assert mentions[0].read_at is None
    await mark_mention_read(server.base_url, "m1")
    assert server.mentions["m1"]["read_at"] is not None


# ----------------------------------------------------------------- pane


async def test_gi_opens_inbox_with_unread(server: _Server) -> None:
    server.add("m1", "note-a", "Alpha")
    server.add("m2", "note-b", "Beta")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        inbox = await _open_inbox(pilot, app)
        assert app.query_one("#right-pane").has_class("visible")
        assert {m.id for m in inbox.mentions} == {"m1", "m2"}
        assert inbox.unread_count == 2


async def test_selecting_mention_marks_read_and_navigates(server: _Server) -> None:
    server.add("m1", "note-a", "Alpha")
    server.add("m2", "note-b", "Beta")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        inbox = await _open_inbox(pilot, app)
        assert inbox.unread_count == 2

        inbox.focus()
        inbox.highlighted = 0
        first_id = inbox.get_option_at_index(0).id
        assert first_id is not None
        await pilot.press("enter")
        await pilot.pause()
        await pilot.pause()

        assert server.mentions[first_id]["read_at"] is not None  # marked read
        assert inbox.unread_count == 1  # unread count dropped
        assert app._doc_name == f"{server.mentions[first_id]['note_id']}"  # navigated

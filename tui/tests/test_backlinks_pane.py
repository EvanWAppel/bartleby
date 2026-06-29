"""T-012: `g b` toggles an inbound-links pane listing notes that link here;
selecting a row opens the source note.

Backlinks come over HTTP (GET /notes/:id/backlinks), so these mount the full
app with ``connect_on_mount=False`` + an in-process server — no websocket.
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
from bartleby_tui.notes_api import fetch_backlinks
from bartleby_tui.panes import BacklinksPane

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    # note_id -> list of {source_id, source_title, link_text}
    backlinks: dict[str, list[dict[str, str]]] = field(default_factory=dict)


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/notes":
                self._json(200, {"notes": []})
                return
            if path.startswith("/notes/") and path.endswith("/backlinks"):
                note_id = path.split("/")[2]
                self._json(200, {"backlinks": state.backlinks.get(note_id, [])})
                return
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


def _seed(server: _Server, note_id: str) -> None:
    server.backlinks[note_id] = [
        {"source_id": "src-1", "source_title": "Alpha", "link_text": "see B"},
        {"source_id": "src-2", "source_title": "Beta", "link_text": "[[B]]"},
    ]


async def _go_backlinks(pilot, app: BartlebyApp) -> None:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")  # normal mode
    await pilot.press("g")
    await pilot.press("b")
    await pilot.pause()
    await pilot.pause()  # let the async fetch resolve


# ----------------------------------------------------------------- api


async def test_fetch_backlinks_parses_rows(server: _Server) -> None:
    _seed(server, "note-A")
    links = await fetch_backlinks(server.base_url, "note-A")
    assert [b.source_id for b in links] == ["src-1", "src-2"]
    assert links[0].source_title == "Alpha"
    assert links[1].link_text == "[[B]]"


# ----------------------------------------------------------------- pane


async def test_gb_opens_backlinks_pane_with_entries(server: _Server) -> None:
    _seed(server, "note-A")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-A")
        await _go_backlinks(pilot, app)

        right = app.query_one("#right-pane")
        assert right.has_class("visible")
        pane = app.query_one("#backlinks-pane", BacklinksPane)
        assert {b.source_id for b in pane.backlinks} == {"src-1", "src-2"}


async def test_gb_again_hides_pane(server: _Server) -> None:
    _seed(server, "note-A")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-A")
        await _go_backlinks(pilot, app)
        assert app.query_one("#right-pane").has_class("visible")

        await _go_backlinks(pilot, app)  # toggle off
        assert not app.query_one("#right-pane").has_class("visible")


async def test_selecting_backlink_opens_source(server: _Server) -> None:
    _seed(server, "note-A")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-A")
        await _go_backlinks(pilot, app)

        pane = app.query_one("#backlinks-pane", BacklinksPane)
        pane.focus()
        pane.highlighted = 0
        await pilot.press("enter")
        await pilot.pause()

        assert app._doc_name == "note:src-1"

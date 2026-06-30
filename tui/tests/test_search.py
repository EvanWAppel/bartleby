"""T-008: `/` search filters the notes list via GET /search; Enter opens the
top result.

Search runs over HTTP (not the websocket), so these mount the full
``BartlebyApp`` with a tiny in-process search server and run locally.
"""

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest

from bartleby_tui.app import BartlebyApp, SearchInput
from bartleby_tui.notes_api import search_notes
from bartleby_tui.notes_list import NotesList

pytestmark = pytest.mark.asyncio


@dataclass
class _MockServer:
    base_url: str
    notes: list[dict[str, Any]] = field(default_factory=list)

    def add(self, title: str) -> str:
        note_id = str(uuid.uuid4())
        self.notes.append(
            {
                "id": note_id,
                "title": title,
                "tags": [],
                "updated_at": "2030-01-01T00:00:00.000Z",
            }
        )
        return note_id


@pytest.fixture
def mock_server() -> Iterator[_MockServer]:
    state = _MockServer(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/notes":
                self._json(200, {"notes": state.notes})
                return
            if parsed.path == "/search":
                q = (parse_qs(parsed.query).get("q") or [""])[0].lower()
                hits = [
                    {"id": n["id"], "title": n["title"], "snippet": n["title"]}
                    for n in state.notes
                    if q and q in n["title"].lower()
                ]
                self._json(200, {"hits": hits})
                return
            self._json(404, {"error": "not_found"})

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    state.base_url = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()


# ----------------------------------------------------------------- api


async def test_search_notes_returns_hit_ids(mock_server: _MockServer) -> None:
    a = mock_server.add("apple pie")
    mock_server.add("banana bread")
    ids = await search_notes(mock_server.base_url, "apple")
    assert ids == [a]


async def test_search_notes_empty_query_skips_request(mock_server: _MockServer) -> None:
    assert await search_notes(mock_server.base_url, "") == []


# ----------------------------------------------------------------- app integration


def _make_app(mock: _MockServer) -> BartlebyApp:
    # connect_on_mount=False → no websocket; http_base_url drives search over HTTP.
    return BartlebyApp(connect_on_mount=False, http_base_url=mock.base_url)


async def test_slash_in_normal_mode_opens_search(mock_server: _MockServer) -> None:
    app = _make_app(mock_server)
    async with app.run_test() as pilot:
        await pilot.pause()
        search = app.query_one("#note-search", SearchInput)
        assert not search.has_class("searching")
        await pilot.press("escape")  # editor → normal mode
        await pilot.press("slash")  # `/`
        await pilot.pause()
        assert search.has_class("searching")


async def test_typing_filters_list_to_search_hits(mock_server: _MockServer) -> None:
    mock_server.add("apple pie")
    mock_server.add("banana bread")
    mock_server.add("apple tart")

    app = _make_app(mock_server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()  # populate the full list + cache
        notes = app.query_one("#notes-pane", NotesList)
        assert notes.option_count == 3

        app._open_search()
        await pilot.pause()
        for ch in "apple":
            await pilot.press(ch)
        await pilot.pause()

        titles = {n.title for n in notes.notes}
        assert titles == {"apple pie", "apple tart"}


async def test_enter_opens_top_result(mock_server: _MockServer) -> None:
    top = mock_server.add("apple pie")
    mock_server.add("banana bread")

    app = _make_app(mock_server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        app._open_search()
        await pilot.pause()
        for ch in "apple":
            await pilot.press(ch)
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()

        assert app._doc_name == f"{top}"


async def test_escape_closes_search_and_restores_list(mock_server: _MockServer) -> None:
    mock_server.add("apple pie")
    mock_server.add("banana bread")

    app = _make_app(mock_server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        notes = app.query_one("#notes-pane", NotesList)
        search = app.query_one("#note-search", SearchInput)

        app._open_search()
        await pilot.pause()
        for ch in "apple":
            await pilot.press(ch)
        await pilot.pause()
        assert notes.option_count == 1  # filtered

        await pilot.press("escape")
        await pilot.pause()
        assert not search.has_class("searching")
        assert notes.option_count == 2  # full list restored

"""T-021: `:` opens a command palette that fuzzy-filters over commands + note
titles; Enter runs the top match (open a note, or run a command).
"""

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

import pytest
from textual.widgets import Input, OptionList

from bartleby_tui.app import BartlebyApp
from bartleby_tui.modals import CommandPalette

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    notes: list[dict[str, Any]] = field(default_factory=list)

    def add(self, title: str) -> str:
        nid = str(uuid.uuid4())
        self.notes.append(
            {"id": nid, "title": title, "tags": [], "updated_at": "2030-01-01T00:00:00.000Z"}
        )
        return nid


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            if urlparse(self.path).path == "/notes":
                self._json(200, {"notes": state.notes})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            if urlparse(self.path).path == "/notes":
                n = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(n).decode()) if n else {}
                nid = state.add(body.get("title") or "Untitled")
                self._json(201, {"id": nid, "title": body.get("title") or "Untitled"})
            else:
                self._json(404, {"error": "not_found"})

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    state.base_url = f"http://127.0.0.1:{srv.server_port}"
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        srv.shutdown()
        srv.server_close()


async def _open_palette(pilot, app: BartlebyApp) -> CommandPalette:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.press(":")
    await pilot.pause()
    assert isinstance(app.screen, CommandPalette)
    return app.screen


async def _type(pilot, app: BartlebyApp, text: str) -> None:
    app.screen.query_one("#palette-input", Input).value = text
    await pilot.pause()


# ---------------------------------------------------------------------------


async def test_colon_opens_palette(server: _Server) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await _open_palette(pilot, app)


async def test_palette_filters_over_note_titles(server: _Server) -> None:
    server.add("alpha")
    server.add("beta")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        palette = await _open_palette(pilot, app)
        await _type(pilot, app, "alph")
        labels = [
            str(palette.query_one("#palette-list", OptionList).get_option_at_index(i).prompt)
            for i in range(palette.query_one("#palette-list", OptionList).option_count)
        ]
        assert "alpha" in labels
        assert "beta" not in labels


async def test_selecting_note_opens_it(server: _Server) -> None:
    nid = server.add("alpha")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        await _open_palette(pilot, app)
        await _type(pilot, app, "alpha")
        await pilot.press("enter")
        await pilot.pause()
        assert app._doc_name == f"note:{nid}"


async def test_command_new_note_runs(server: _Server) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        await _open_palette(pilot, app)
        await _type(pilot, app, "new")
        await pilot.press("enter")
        await pilot.pause()
        await pilot.pause()
        assert len(server.notes) == 1  # `new note` command created one
        assert app._doc_name == f"note:{server.notes[0]['id']}"

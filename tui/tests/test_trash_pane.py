"""T-016: `g t` opens a trash view of soft-deleted notes; `R` restores, `D`
deletes forever.

Trash ops are HTTP (GET /notes/trash, POST restore, DELETE ?forever=true), so
these mount the full app with ``connect_on_mount=False`` + an in-process
server — no websocket.
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

from bartleby_tui.app import BartlebyApp
from bartleby_tui.notes_api import delete_note_forever, fetch_trash
from bartleby_tui.panes import TrashPane

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    notes: dict[str, dict[str, Any]] = field(default_factory=dict)

    def add_trashed(self, title: str) -> str:
        note_id = str(uuid.uuid4())
        self.notes[note_id] = {
            "id": note_id,
            "title": title,
            "tags": [],
            "updated_at": "2030-01-01T00:00:00.000Z",
            "trashed": True,
        }
        return note_id

    def _summaries(self, *, trashed: bool) -> list[dict[str, Any]]:
        return [
            {k: n[k] for k in ("id", "title", "tags", "updated_at")}
            for n in self.notes.values()
            if n["trashed"] is trashed
        ]


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/notes/trash":
                self._json(200, {"notes": state._summaries(trashed=True)})
            elif path == "/notes":
                self._json(200, {"notes": state._summaries(trashed=False)})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path.endswith("/restore"):
                note_id = path.split("/")[2]
                if note_id in state.notes:
                    state.notes[note_id]["trashed"] = False
                self._json(200, {})
            else:
                self._json(404, {"error": "not_found"})

        def do_DELETE(self) -> None:
            parsed = urlparse(self.path)
            note_id = parsed.path.split("/")[2]
            if "forever=true" in parsed.query:
                state.notes.pop(note_id, None)
            elif note_id in state.notes:
                state.notes[note_id]["trashed"] = True
            self._json(204, {})

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


async def _open_trash(pilot, app: BartlebyApp) -> TrashPane:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.press("g")
    await pilot.press("t")
    await pilot.pause()
    await pilot.pause()  # let the async fetch resolve
    return app.query_one("#trash-pane", TrashPane)


# ----------------------------------------------------------------- api


async def test_fetch_trash_and_delete_forever(server: _Server) -> None:
    note_id = server.add_trashed("ghost")
    trash = await fetch_trash(server.base_url)
    assert [n.id for n in trash] == [note_id]
    await delete_note_forever(server.base_url, note_id)
    assert note_id not in server.notes


# ----------------------------------------------------------------- pane


async def test_gt_opens_trash_pane_with_entries(server: _Server) -> None:
    note_id = server.add_trashed("ghost")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        trash = await _open_trash(pilot, app)
        assert app.query_one("#right-pane").has_class("visible")
        assert [n.id for n in trash.notes] == [note_id]


async def test_R_restores_from_trash(server: _Server) -> None:
    note_id = server.add_trashed("comeback")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        trash = await _open_trash(pilot, app)
        trash.focus()
        trash.highlighted = 0
        await pilot.press("R")
        await pilot.pause()
        await pilot.pause()

        assert server.notes[note_id]["trashed"] is False  # restored
        assert note_id not in [n.id for n in trash.notes]  # gone from trash view


async def test_D_deletes_forever(server: _Server) -> None:
    note_id = server.add_trashed("doomed")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        trash = await _open_trash(pilot, app)
        trash.focus()
        trash.highlighted = 0
        await pilot.press("D")
        await pilot.pause()
        await pilot.pause()

        assert note_id not in server.notes  # hard-deleted

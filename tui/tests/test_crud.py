"""T-010: note CRUD keybinds — `n` new, `r` rename (modal), `d` delete
(confirm), `R` restore.

CRUD is HTTP (POST/PATCH/DELETE /notes), so these mount the full app with
``connect_on_mount=False`` + an in-process notes server and run locally.
"""

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest
from textual.widgets import Input

from bartleby_tui.app import BartlebyApp
from bartleby_tui.modals import ConfirmModal, RenameModal
from bartleby_tui.notes_api import create_note, delete_note, rename_note, restore_note
from bartleby_tui.notes_list import NotesList

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    notes: dict[str, dict[str, Any]] = field(default_factory=dict)

    def add(self, title: str) -> str:
        note_id = str(uuid.uuid4())
        self.notes[note_id] = {
            "id": note_id,
            "title": title,
            "tags": [],
            "updated_at": "2030-01-01T00:00:00.000Z",
            "trashed": False,
        }
        return note_id

    def live(self) -> list[dict[str, Any]]:
        return [
            {k: n[k] for k in ("id", "title", "tags", "updated_at")}
            for n in self.notes.values()
            if not n["trashed"]
        ]


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length) if length else b""
            return json.loads(raw.decode()) if raw else {}

        def do_GET(self) -> None:
            if self.path == "/notes":
                self._json(200, {"notes": state.live()})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            if self.path == "/notes":
                title = self._body().get("title") or "Untitled"
                note_id = state.add(title)
                self._json(201, {"id": note_id, "title": title})
            elif self.path.endswith("/restore"):
                note_id = self.path.split("/")[2]
                state.notes[note_id]["trashed"] = False
                self._json(200, {})
            else:
                self._json(404, {"error": "not_found"})

        def do_PATCH(self) -> None:
            note_id = self.path.split("/")[2]
            title = self._body().get("title")
            if note_id in state.notes and isinstance(title, str):
                state.notes[note_id]["title"] = title
            self._json(200, state.notes.get(note_id, {}))

        def do_DELETE(self) -> None:
            note_id = self.path.split("/")[2]
            if note_id in state.notes:
                state.notes[note_id]["trashed"] = True
            self._json(200, {})

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


# ----------------------------------------------------------------- api round-trips


async def test_api_create_rename_delete_restore(server: _Server) -> None:
    note_id = await create_note(server.base_url, "first")
    assert server.notes[note_id]["title"] == "first"
    await rename_note(server.base_url, note_id, "second")
    assert server.notes[note_id]["title"] == "second"
    await delete_note(server.base_url, note_id)
    assert server.notes[note_id]["trashed"] is True
    await restore_note(server.base_url, note_id)
    assert server.notes[note_id]["trashed"] is False


# ----------------------------------------------------------------- keybinds


def _app(server: _Server) -> BartlebyApp:
    return BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)


async def _enter_normal(pilot, app: BartlebyApp) -> None:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.pause()


async def test_n_creates_and_opens_note(server: _Server) -> None:
    app = _app(server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await _enter_normal(pilot, app)
        await pilot.press("n")
        await pilot.pause()
        await pilot.pause()

        assert len(server.notes) == 1
        new_id = next(iter(server.notes))
        assert app._doc_name == f"note:{new_id}"


async def test_r_renames_current_note(server: _Server) -> None:
    note_id = server.add("old title")
    app = _app(server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note(note_id)
        await app._refresh_notes()
        await _enter_normal(pilot, app)

        await pilot.press("r")
        await pilot.pause()
        assert isinstance(app.screen, RenameModal)
        app.screen.query_one("#rename-input", Input).value = "new title"
        await pilot.press("enter")
        await pilot.pause()
        await pilot.pause()

        assert server.notes[note_id]["title"] == "new title"


async def test_d_deletes_after_confirm(server: _Server) -> None:
    note_id = server.add("doomed")
    app = _app(server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note(note_id)
        await app._refresh_notes()
        notes = app.query_one("#notes-pane", NotesList)
        assert notes.option_count == 1
        await _enter_normal(pilot, app)

        await pilot.press("d")
        await pilot.pause()
        assert isinstance(app.screen, ConfirmModal)
        await pilot.press("y")
        await pilot.pause()
        await pilot.pause()

        assert server.notes[note_id]["trashed"] is True
        assert app._last_deleted == note_id


async def test_R_restores_last_deleted(server: _Server) -> None:
    note_id = server.add("comeback")
    app = _app(server)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note(note_id)
        await app._refresh_notes()
        await _enter_normal(pilot, app)

        # delete it
        await pilot.press("d")
        await pilot.pause()
        await pilot.press("y")
        await pilot.pause()
        await pilot.pause()
        assert server.notes[note_id]["trashed"] is True

        # restore it
        await _enter_normal(pilot, app)
        await pilot.press("R")
        await pilot.pause()
        await pilot.pause()

        assert server.notes[note_id]["trashed"] is False

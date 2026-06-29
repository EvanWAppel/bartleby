"""T-015: `g h` opens a snapshots/history pane; Enter restores (with confirm).

List + restore are HTTP (GET /notes/:id/snapshots, POST .../restore), so these
mount the full app with ``connect_on_mount=False`` + an in-process server.

The actual *doc replacement* on restore is a server effect (C-006 writes a
pre-restore snapshot and applies the Yjs state to the live doc, which reaches
the editor via collab sync) — that round-trip is covered by the server tests
and a CI websocket test. Here we assert the restore is requested.
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
from bartleby_tui.modals import ConfirmModal
from bartleby_tui.notes_api import fetch_snapshots, restore_snapshot
from bartleby_tui.panes import SnapshotsPane

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    snapshots: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    restored: list[tuple[str, str]] = field(default_factory=list)  # (note_id, snap_id)

    def add(self, note_id: str, snap_id: str, label: str | None) -> None:
        self.snapshots.setdefault(note_id, []).append(
            {
                "id": snap_id,
                "note_id": note_id,
                "label": label,
                "created_at": "2030-01-01T00:00:00.000Z",
            }
        )


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            parts = urlparse(self.path).path.split("/")
            # /notes/<id>/snapshots
            if len(parts) == 4 and parts[1] == "notes" and parts[3] == "snapshots":
                self._json(200, {"snapshots": state.snapshots.get(parts[2], [])})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            parts = urlparse(self.path).path.split("/")
            # /notes/<id>/snapshots/<snap>/restore
            if len(parts) == 6 and parts[3] == "snapshots" and parts[5] == "restore":
                state.restored.append((parts[2], parts[4]))
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


async def _open_history(pilot, app: BartlebyApp) -> SnapshotsPane:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.press("g")
    await pilot.press("h")
    await pilot.pause()
    await pilot.pause()
    return app.query_one("#history-pane", SnapshotsPane)


# ----------------------------------------------------------------- api


async def test_fetch_and_restore(server: _Server) -> None:
    server.add("note-a", "snap-1", "before edit")
    snaps = await fetch_snapshots(server.base_url, "note-a")
    assert [s.id for s in snaps] == ["snap-1"]
    assert snaps[0].label == "before edit"
    await restore_snapshot(server.base_url, "note-a", "snap-1")
    assert server.restored == [("note-a", "snap-1")]


# ----------------------------------------------------------------- pane


async def test_gh_opens_history_with_snapshots(server: _Server) -> None:
    server.add("note-a", "snap-1", "v1")
    server.add("note-a", "snap-2", None)
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_history(pilot, app)
        assert app.query_one("#right-pane").has_class("visible")
        assert {s.id for s in pane.snapshots} == {"snap-1", "snap-2"}


async def test_enter_confirms_then_restores(server: _Server) -> None:
    server.add("note-a", "snap-1", "v1")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_history(pilot, app)

        pane.focus()
        pane.highlighted = 0
        await pilot.press("enter")
        await pilot.pause()
        assert isinstance(app.screen, ConfirmModal)
        await pilot.press("y")
        await pilot.pause()
        await pilot.pause()

        assert server.restored == [("note-a", "snap-1")]

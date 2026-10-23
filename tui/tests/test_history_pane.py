"""T-015: `g h` opens a snapshots/history pane; Enter restores (with confirm).

List + restore are HTTP (GET /notes/:id/snapshots, POST .../restore), so these
mount the full app with ``connect_on_mount=False`` + an in-process server.

The actual *doc replacement* on restore is a server effect (C-006 writes a
pre-restore snapshot and applies the Yjs state to the live doc, which reaches
the editor via collab sync) — that round-trip is covered by the server tests
and a CI websocket test. Here we assert the restore is requested.
"""

from __future__ import annotations

import base64
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
from bartleby_tui.notes_api import fetch_snapshot_state, fetch_snapshots, restore_snapshot
from bartleby_tui.panes import SnapshotPreview, SnapshotsPane
from bartleby_tui.renderer import snapshot_state_to_blocks

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    snapshots: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    restored: list[tuple[str, str]] = field(default_factory=list)  # (note_id, snap_id)
    # T-028: snap_id -> Yjs state served by GET /notes/:id/snapshots/:snap_id.
    states: dict[str, bytes] = field(default_factory=dict)
    detail_fetches: list[str] = field(default_factory=list)

    def add(
        self, note_id: str, snap_id: str, label: str | None, state: bytes = b"\x00\x00"
    ) -> None:
        self.snapshots.setdefault(note_id, []).append(
            {
                "id": snap_id,
                "note_id": note_id,
                "label": label,
                "created_at": "2030-01-01T00:00:00.000Z",
            }
        )
        self.states[snap_id] = state


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
            # /notes/<id>/snapshots/<snap> (detail, with the Yjs blob)
            elif len(parts) == 5 and parts[1] == "notes" and parts[3] == "snapshots":
                row = next(
                    (r for r in state.snapshots.get(parts[2], []) if r["id"] == parts[4]), None
                )
                if row is None:
                    self._json(404, {"error": "not_found"})
                    return
                state.detail_fetches.append(parts[4])
                blob = state.states[parts[4]]
                self._json(
                    200,
                    {
                        **row,
                        "yjs_state_base64": base64.b64encode(blob).decode("ascii"),
                        "markdown_preview": "",
                    },
                )
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


# ----------------------------------------------------------------- T-028 preview


def _plain(renderable: object) -> str:
    import io

    from rich.console import Console

    console = Console(file=io.StringIO(), width=80, record=True)
    console.print(renderable, end="")
    return console.export_text(clear=True)


async def test_fetch_snapshot_state_decodes_base64(server: _Server, snapshot_blob: bytes) -> None:
    server.add("note-a", "snap-1", "v1", snapshot_blob)
    state = await fetch_snapshot_state(server.base_url, "note-a", "snap-1")
    assert state == snapshot_blob


async def test_snapshot_state_decodes_with_the_renderer(snapshot_blob: bytes) -> None:
    blocks = snapshot_state_to_blocks(snapshot_blob)
    assert [b.kind for b in blocks] == ["heading", "paragraph"]
    assert blocks[0].inlines[0].text == "Old heading"
    assert blocks[1].inlines[0].text == "what the note said back then"


async def test_highlighting_a_snapshot_previews_its_content(
    server: _Server, snapshot_blob: bytes
) -> None:
    server.add("note-a", "snap-1", "v1", snapshot_blob)
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_history(pilot, app)
        pane.highlighted = 0
        await pilot.pause()
        await pilot.pause()

        preview = app.query_one("#history-preview", SnapshotPreview)
        assert preview.display
        assert preview.snapshot_id == "snap-1"
        text = _plain(preview.rendered)
        assert "## Old heading" in text
        assert "what the note said back then" in text
        # Previewing is read-only: nothing was restored.
        assert server.restored == []


async def test_moving_highlight_swaps_preview(server: _Server, snapshot_blob: bytes) -> None:
    import y_py as Y

    other = Y.YDoc()
    xml = other.get_xml_element("prosemirror")
    with other.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        xml.push_xml_element(txn, "paragraph").push_xml_text(txn).push(txn, "newer text")
    server.add("note-a", "snap-new", None, bytes(Y.encode_state_as_update(other)))
    server.add("note-a", "snap-old", "v1", snapshot_blob)
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_history(pilot, app)
        pane.highlighted = 0
        await pilot.pause()
        await pilot.pause()
        preview = app.query_one("#history-preview", SnapshotPreview)
        assert "newer text" in _plain(preview.rendered)

        pane.highlighted = 1
        await pilot.pause()
        await pilot.pause()
        assert preview.snapshot_id == "snap-old"
        text = _plain(preview.rendered)
        assert "Old heading" in text
        assert "newer text" not in text


async def test_preview_hidden_outside_history(server: _Server) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        preview = app.query_one("#history-preview", SnapshotPreview)
        assert not preview.display

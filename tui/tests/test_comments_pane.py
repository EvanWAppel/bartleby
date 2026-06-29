"""T-013/T-014: `g c` comments pane — list threads, `c` new, Enter expands,
`r` reply, `x` resolve.

Comments are HTTP (CRUD under /notes/:id/comments + /comments/:id/*), so these
mount the full app with ``connect_on_mount=False`` + an in-process server.
Body markers/anchoring are deferred (the TUI creates note-level comments).
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
from textual.widgets import Input

from bartleby_tui.app import BartlebyApp
from bartleby_tui.modals import TextInputModal
from bartleby_tui.notes_api import create_comment, fetch_comments, reply_comment, resolve_comment
from bartleby_tui.panes import CommentsPane

pytestmark = pytest.mark.asyncio


@dataclass
class _Server:
    base_url: str
    comments: list[dict[str, Any]] = field(default_factory=list)

    def add(self, note_id: str, body: str, parent: str | None = None) -> str:
        cid = str(uuid.uuid4())
        self.comments.append(
            {
                "id": cid,
                "note_id": note_id,
                "parent_comment_id": parent,
                "author_id": "u-1",
                "body": body,
                "resolved_at": None,
                "created_at": "2030-01-01T00:00:00.000Z",
            }
        )
        return cid

    def find(self, cid: str) -> dict[str, Any] | None:
        return next((c for c in self.comments if c["id"] == cid), None)


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def _read(self) -> dict[str, Any]:
            n = int(self.headers.get("content-length", "0"))
            return json.loads(self.rfile.read(n).decode()) if n else {}

        def do_GET(self) -> None:
            parts = urlparse(self.path).path.split("/")
            if len(parts) == 4 and parts[1] == "notes" and parts[3] == "comments":
                rows = [c for c in state.comments if c["note_id"] == parts[2]]
                self._json(200, {"comments": rows})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self) -> None:
            parts = urlparse(self.path).path.split("/")
            body = self._read().get("body", "")
            if len(parts) == 4 and parts[1] == "notes" and parts[3] == "comments":
                state.add(parts[2], body)
                self._json(201, {})
            elif len(parts) == 4 and parts[1] == "comments" and parts[3] == "replies":
                parent = state.find(parts[2])
                if parent is not None:
                    state.add(parent["note_id"], body, parent=parts[2])
                self._json(201, {})
            else:
                self._json(404, {"error": "not_found"})

        def do_PATCH(self) -> None:
            parts = urlparse(self.path).path.split("/")
            if len(parts) == 4 and parts[1] == "comments" and parts[3] == "resolve":
                row = state.find(parts[2])
                if row is not None:
                    row["resolved_at"] = "2030-02-02T00:00:00.000Z"
                self._json(200, {})
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


async def _open_comments(pilot, app: BartlebyApp) -> CommentsPane:
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.press("g")
    await pilot.press("c")
    await pilot.pause()
    await pilot.pause()
    return app.query_one("#comments-pane", CommentsPane)


async def _submit_modal(pilot, app: BartlebyApp, text: str) -> None:
    assert isinstance(app.screen, TextInputModal)
    app.screen.query_one("#text-input-field", Input).value = text
    await pilot.press("enter")
    await pilot.pause()
    await pilot.pause()


# ----------------------------------------------------------------- api


async def test_comment_api_round_trip(server: _Server) -> None:
    await create_comment(server.base_url, "note-a", "first!")
    comments = await fetch_comments(server.base_url, "note-a")
    assert [c.body for c in comments] == ["first!"]
    root = comments[0].id
    await reply_comment(server.base_url, root, "a reply")
    await resolve_comment(server.base_url, root)
    comments = await fetch_comments(server.base_url, "note-a")
    assert any(c.parent_comment_id == root and c.body == "a reply" for c in comments)
    assert next(c for c in comments if c.id == root).resolved_at is not None


# ----------------------------------------------------------------- pane


async def test_gc_lists_threads(server: _Server) -> None:
    server.add("note-a", "hello")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_comments(pilot, app)
        assert app.query_one("#right-pane").has_class("visible")
        assert [c.body for c in pane.comments] == ["hello"]


async def test_c_creates_comment(server: _Server) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_comments(pilot, app)
        pane.focus()
        await pilot.press("c")
        await pilot.pause()
        await _submit_modal(pilot, app, "brand new")
        assert "brand new" in [c.body for c in pane.comments]


async def test_enter_expands_thread_to_show_replies(server: _Server) -> None:
    root = server.add("note-a", "root")
    server.add("note-a", "the reply", parent=root)
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_comments(pilot, app)
        pane.focus()
        pane.highlighted = 0
        assert pane.option_count == 1  # collapsed: just the root
        await pilot.press("enter")
        await pilot.pause()
        assert pane.option_count == 2  # root + reply now visible
        assert root in pane.expanded


async def test_r_replies_to_thread(server: _Server) -> None:
    server.add("note-a", "root")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_comments(pilot, app)
        pane.focus()
        pane.highlighted = 0
        await pilot.press("r")
        await pilot.pause()
        await _submit_modal(pilot, app, "my reply")
        assert any(c.body == "my reply" and c.parent_comment_id for c in pane.comments)


async def test_x_resolves_thread(server: _Server) -> None:
    root = server.add("note-a", "root")
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app.open_note("note-a")
        pane = await _open_comments(pilot, app)
        pane.focus()
        pane.highlighted = 0
        await pilot.press("x")
        await pilot.pause()
        await pilot.pause()
        assert server.find(root) is not None
        assert next(c for c in pane.comments if c.id == root).resolved_at is not None

"""T-006 (deferred): typing `[[` opens a notes picker that inserts a backlink
atom; typing `@` opens a users picker that inserts a mention atom.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

import pytest
from textual.widgets import Input

from bartleby_tui.app import BartlebyApp
from bartleby_tui.modals import CommandPalette
from bartleby_tui.notes_api import Note
from bartleby_tui.renderer import ydoc_to_blocks

pytestmark = pytest.mark.asyncio


def _atoms(app: BartlebyApp, kind: str) -> list[Any]:
    inlines = [i for b in ydoc_to_blocks(app._doc) for i in b.inlines]
    return [i for i in inlines if i.atom_kind == kind]


# ----------------------------------------------------------------- backlink `[[`


async def test_double_bracket_opens_backlink_picker_and_inserts_atom() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        app._all_notes = [Note(id="n1", title="Target", tags=(), updated_at="2030-01-01T00:00:00Z")]
        assert app._editor is not None
        app._editor.focus()  # insert mode by default

        await pilot.press("left_square_bracket", "left_square_bracket")
        await pilot.pause()
        assert isinstance(app.screen, CommandPalette)  # picker opened

        app.screen.query_one("#palette-input", Input).value = "Target"
        await pilot.pause()
        await pilot.press("enter")  # choose the note
        await pilot.pause()

        backlinks = _atoms(app, "backlink")
        assert backlinks and backlinks[0].target_id == "n1"


# ----------------------------------------------------------------- mention `@`


@dataclass
class _UsersServer:
    base_url: str


@pytest.fixture
def users_server() -> Iterator[_UsersServer]:
    state = _UsersServer(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            if urlparse(self.path).path == "/users":
                body = json.dumps(
                    {"users": [{"email": "alice@example.com", "display_name": "Alice"}]}
                ).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                self.end_headers()

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    state.base_url = f"http://127.0.0.1:{srv.server_port}"
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        srv.shutdown()
        srv.server_close()


async def test_at_opens_mention_picker_and_inserts_atom(users_server: _UsersServer) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=users_server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app._editor is not None
        app._editor.focus()

        await pilot.press("@")
        await pilot.pause()
        await pilot.pause()  # let fetch_users resolve
        assert isinstance(app.screen, CommandPalette)

        app.screen.query_one("#palette-input", Input).value = "Alice"
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()

        mentions = _atoms(app, "mention")
        assert mentions and "Alice" in mentions[0].text

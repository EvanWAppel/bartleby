"""T-022/T-023: `:export` writes a note's markdown to a chosen path;
`:export-all` writes the all-notes zip.

Export is HTTP (GET /notes/:id/export.md, GET /export/all.zip) + a local file
write, so these mount the full app with ``connect_on_mount=False`` + an
in-process server and write into ``tmp_path``.
"""

from __future__ import annotations

import io
import json
import threading
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytest
from textual.widgets import Input

from bartleby_tui.app import BartlebyApp
from bartleby_tui.modals import TextInputModal
from bartleby_tui.notes_api import export_all_zip, export_note_markdown

pytestmark = pytest.mark.asyncio

_MD = "---\ntags: []\n---\n# Alpha\n\nbody text\n"
_ZIP_FILES = {"alpha.md": "# Alpha\n", "beta.md": "# Beta\n"}


def _zip_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in _ZIP_FILES.items():
            zf.writestr(name, content)
    return buf.getvalue()


@dataclass
class _Server:
    base_url: str


@pytest.fixture
def server() -> Iterator[_Server]:
    state = _Server(base_url="")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/notes":
                self._json(
                    200,
                    {
                        "notes": [
                            {
                                "id": "note-a",
                                "title": "Alpha",
                                "tags": [],
                                "updated_at": "2030-01-01T00:00:00Z",
                            }
                        ]
                    },
                )
            elif path.endswith("/export.md"):
                self._raw(200, "text/markdown", _MD.encode())
            elif path == "/export/all.zip":
                self._raw(200, "application/zip", _zip_bytes())
            else:
                self._json(404, {"error": "not_found"})

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            self._raw(status, "application/json", json.dumps(payload).encode())

        def _raw(self, status: int, ctype: str, data: bytes) -> None:
            self.send_response(status)
            self.send_header("content-type", ctype)
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


async def _run_command(pilot, app: BartlebyApp, query: str, out_path: Path) -> None:
    """`:` → type the command → Enter → fill the path modal → Enter."""
    assert app._editor is not None
    app._editor.focus()
    await pilot.press("escape")
    await pilot.press(":")
    await pilot.pause()
    app.screen.query_one("#palette-input", Input).value = query
    await pilot.pause()
    await pilot.press("enter")  # run the top match
    await pilot.pause()
    assert isinstance(app.screen, TextInputModal)
    app.screen.query_one("#text-input-field", Input).value = str(out_path)
    await pilot.press("enter")  # submit the path
    await pilot.pause()
    await pilot.pause()


# ----------------------------------------------------------------- api


async def test_export_apis(server: _Server) -> None:
    md = await export_note_markdown(server.base_url, "note-a")
    assert md == _MD
    data = await export_all_zip(server.base_url)
    assert zipfile.is_zipfile(io.BytesIO(data))


# ----------------------------------------------------------------- palette commands


async def test_export_writes_markdown_file(server: _Server, tmp_path: Path) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        await app.open_note("note-a")
        out = tmp_path / "exported.md"
        await _run_command(pilot, app, "export", out)
        assert out.read_text(encoding="utf-8") == _MD


async def test_export_all_writes_zip(server: _Server, tmp_path: Path) -> None:
    app = BartlebyApp(connect_on_mount=False, http_base_url=server.base_url)
    async with app.run_test() as pilot:
        await pilot.pause()
        await app._refresh_notes()
        out = tmp_path / "all.zip"
        await _run_command(pilot, app, "export-all", out)
        assert out.exists()
        with zipfile.ZipFile(out) as zf:
            assert set(zf.namelist()) == set(_ZIP_FILES)

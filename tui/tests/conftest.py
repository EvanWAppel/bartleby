"""Shared pytest fixtures per agents.md.

Most fixtures here are about wrapping the real Hocuspocus server in
`../server` as a subprocess so integration tests run against the actual
collab server (no mocks).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import shutil
import signal
import socket
import subprocess
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

import pytest
import pytest_asyncio

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_DIR = REPO_ROOT / "server"


@dataclass
class MockDeviceAuthServer:
    base_url: str
    device_code: str
    user_code: str
    access_token: str
    refresh_token: str
    approved: bool = False
    expired: bool = False
    poll_count: int = 0

    def approve(self) -> None:
        self.approved = True

    def expire(self) -> None:
        self.expired = True


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_tcp(host: str, port: int, timeout: float = 30.0) -> None:
    """Poll until the TCP port accepts a connection, raising on timeout."""
    loop = asyncio.new_event_loop()

    async def wait() -> None:
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            try:
                _reader, writer = await asyncio.open_connection(host, port)
                writer.close()
                await writer.wait_closed()
                return
            except OSError:
                await asyncio.sleep(0.1)
        raise TimeoutError(f"server on {host}:{port} did not start within {timeout}s")

    try:
        loop.run_until_complete(wait())
    finally:
        loop.close()


@pytest.fixture(scope="session")
def hocuspocus_server() -> Iterator[str]:
    """Boot the bartleby-server as a subprocess; yield its WebSocket base URL."""
    if shutil.which("npm") is None:
        pytest.skip("npm not on PATH; cannot start the integration server")
    if not (SERVER_DIR / "node_modules").is_dir():
        pytest.skip(f"{SERVER_DIR}/node_modules missing; run `npm --prefix server install`")

    port = _pick_free_port()
    env = {**os.environ, "PORT": str(port), "NPM_CONFIG_CACHE": "/tmp/bartleby-npm-cache"}

    # tsx (non-watch) is fastest to start and avoids restart loops mid-test.
    process = subprocess.Popen(
        ["npm", "run", "start:test"],
        cwd=str(SERVER_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )

    try:
        _wait_for_tcp("127.0.0.1", port)
        yield f"ws://127.0.0.1:{port}"
    finally:
        # Terminate the entire process group: npm spawns tsx which spawns node.
        # ProcessLookupError: the group is already gone — fine.
        # PermissionError: some sandboxed environments deny killpg on subprocesses
        # we spawned; the OS will reap them at process exit, so skip teardown.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


@pytest_asyncio.fixture
async def yield_event_loop() -> AsyncIterator[None]:
    """Pump the event loop briefly. Useful after triggering async sends."""
    yield
    await asyncio.sleep(0)


@pytest.fixture
def mock_device_auth_server() -> Iterator[MockDeviceAuthServer]:
    """Small HTTP server that implements the A-006/A-008 device endpoints."""

    state = MockDeviceAuthServer(
        base_url="",
        device_code="mock-device-code",
        user_code="MOCK-CODE",
        access_token="mock-access-token",
        refresh_token="mock-refresh-token",
    )

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            del format, args
            return

        def do_POST(self) -> None:
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            _body = json.loads(raw.decode("utf-8"))
            if self.path == "/auth/device/start":
                self._json(
                    200,
                    {
                        "device_code": state.device_code,
                        "user_code": state.user_code,
                        "verification_uri": f"{state.base_url}/device",
                        "interval": 0,
                        "expires_in": 600,
                    },
                )
                return
            if self.path == "/auth/device/poll":
                state.poll_count += 1
                if state.expired:
                    self._json(410, {"error": {"code": "expired", "message": "expired"}})
                    return
                if not state.approved:
                    self._json(
                        428,
                        {
                            "error": {
                                "code": "authorization_pending",
                                "message": "pending approval",
                            },
                        },
                    )
                    return
                self._json(
                    200,
                    {
                        "access_token": state.access_token,
                        "refresh_token": state.refresh_token,
                        "token_type": "Bearer",
                        "expires_in": 900,
                    },
                )
                return
            self._json(404, {"error": {"code": "not_found", "message": "not found"}})

        def _json(self, status: int, payload: dict[str, object]) -> None:
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    state.base_url = f"http://127.0.0.1:{server.server_port}"
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()

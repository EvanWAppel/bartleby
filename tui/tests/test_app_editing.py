"""V-008 acceptance: keystrokes in the TUI propagate into the YDoc and out
to peer clients via the server."""

from __future__ import annotations

import asyncio

import pytest
import y_py as Y

from bartleby_tui.app import BartlebyApp
from bartleby_tui.connection import HocuspocusConnection

pytestmark = pytest.mark.asyncio


async def _wait_until_synced(app: BartlebyApp, pilot, timeout: float = 5.0) -> None:
    elapsed = 0.0
    step = 0.05
    while elapsed < timeout:
        if app.connection is not None and app.connection.is_synced:
            return
        await pilot.pause(step)
        elapsed += step
    raise TimeoutError("app never synced")


async def test_keystrokes_update_local_ydoc(hocuspocus_server: str) -> None:
    """Typing in the editor widget should mutate the underlying YDoc."""
    room = f"app-local-edit-{id(object())}"
    app = BartlebyApp(server_url=hocuspocus_server, doc_name=room)

    async with app.run_test() as pilot:
        await _wait_until_synced(app, pilot)

        await pilot.press("h", "e", "l", "l", "o")
        await pilot.pause(0.2)

        assert app.rendered_body == "hello"
        assert app.body_text == "hello"


async def test_keystrokes_propagate_to_peer(hocuspocus_server: str) -> None:
    """A keystroke locally should reach a separate y-py peer via the server."""
    room = f"app-edit-prop-{id(object())}"

    app = BartlebyApp(server_url=hocuspocus_server, doc_name=room)
    peer_doc = Y.YDoc()

    async with (
        app.run_test() as pilot,
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=peer_doc) as peer,
    ):
        await _wait_until_synced(app, pilot)
        await asyncio.wait_for(peer.wait_synced(), timeout=5.0)

        await pilot.press("h", "i")

        for _ in range(80):
            if "hi" in str(peer_doc.get_text("body")):
                break
            await pilot.pause(0.05)

        assert "hi" in str(peer_doc.get_text("body"))

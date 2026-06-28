"""V-008 / T-006 acceptance: keystrokes in the TUI mutate the prosemirror
fragment and propagate to peer clients via the server.

As of T-006 the editable surface is the ``StructuredEditor`` over the
``prosemirror`` fragment (not the old flat ``body`` YText), so peers now read
the change off that fragment — the same one the web client uses.
"""

from __future__ import annotations

import asyncio

import pytest
import y_py as Y

from bartleby_tui.app import BartlebyApp
from bartleby_tui.connection import HocuspocusConnection
from bartleby_tui.renderer import ydoc_to_blocks

pytestmark = pytest.mark.asyncio


def _fragment_text(doc: Y.YDoc) -> str:
    """Concatenate all leaf-block text in a doc's prosemirror fragment."""
    parts: list[str] = []

    def walk(blocks: list) -> None:
        for block in blocks:
            if block.children:
                walk(block.children)
            else:
                parts.append("".join(i.text for i in block.inlines))

    walk(ydoc_to_blocks(doc))
    return " ".join(p for p in parts if p)


async def _wait_until_synced(app: BartlebyApp, pilot, timeout: float = 5.0) -> None:
    elapsed = 0.0
    step = 0.05
    while elapsed < timeout:
        if app.connection is not None and app.connection.is_synced:
            return
        await pilot.pause(step)
        elapsed += step
    raise TimeoutError("app never synced")


async def test_keystrokes_update_local_ydoc() -> None:
    """Typing in the editor should mutate the prosemirror fragment.

    No server needed — this is purely local editing, so we skip the
    connection (and the textual + live-websocket deadlock with it).
    """
    app = BartlebyApp(connect_on_mount=False)

    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("h", "e", "l", "l", "o")
        await pilot.pause()

        assert app.body_text == "hello"
        assert _fragment_text(app._doc) == "hello"


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
            if "hi" in _fragment_text(peer_doc):
                break
            await pilot.pause(0.05)

        assert "hi" in _fragment_text(peer_doc)

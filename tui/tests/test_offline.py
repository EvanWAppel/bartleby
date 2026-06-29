"""T-019: offline behavior — edits made while disconnected are counted as
`pending` and sync automatically on reconnect.

``test_pending_counts_offline_edits`` is a pure unit test (no server). The
disconnect→reconnect→sync round-trip needs a live server + websocket, so it's
CI-gated like the other connection integration tests.
"""

from __future__ import annotations

import asyncio

import pytest
import y_py as Y

from bartleby_tui.connection import HocuspocusConnection

pytestmark = pytest.mark.asyncio


def _append_paragraph(doc: Y.YDoc, text: str) -> None:
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        para = xml.push_xml_element(txn, "paragraph")
        para.push_xml_text(txn).push(txn, text)


def _fragment_text(doc: Y.YDoc) -> str:
    parts: list[str] = []
    node = doc.get_xml_element("prosemirror").first_child
    while node is not None:
        parts.append(str(node))
        node = node.next_sibling
    return " ".join(parts)


async def test_pending_counts_offline_edits() -> None:
    """A local edit while not connected bumps `pending` (no server needed)."""
    doc = Y.YDoc()
    conn = HocuspocusConnection(url="ws://127.0.0.1:1", doc_name="x", document=doc)
    # Subscribe the local-transaction observer exactly as __aenter__ would,
    # but without ever connecting — so we're permanently "offline" here.
    conn._sub_handle = doc.observe_after_transaction(conn._on_local_transaction)

    assert conn.pending == 0
    _append_paragraph(doc, "made offline")
    await asyncio.sleep(0)  # let the observer's call_soon run
    assert conn.pending >= 1


async def test_offline_edit_syncs_after_reconnect(hocuspocus_server: str) -> None:
    """Drop the socket, edit, and assert a peer sees it after auto-reconnect."""
    room = f"offline-{id(object())}"
    doc = Y.YDoc()
    peer_doc = Y.YDoc()

    async with (
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=doc) as conn,
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=peer_doc) as peer,
    ):
        await asyncio.wait_for(conn.wait_synced(), timeout=5.0)
        await asyncio.wait_for(peer.wait_synced(), timeout=5.0)

        # Force an unexpected disconnect.
        assert conn._ws is not None
        await conn._ws.close()
        for _ in range(60):
            if not conn.is_connected:
                break
            await asyncio.sleep(0.05)

        # Edit while (briefly) offline — stays in the YDoc, syncs on reconnect.
        _append_paragraph(doc, "made offline")

        for _ in range(200):
            if conn.is_connected and "made offline" in _fragment_text(peer_doc):
                break
            await asyncio.sleep(0.05)

        assert conn.is_connected  # auto-reconnected
        assert "made offline" in _fragment_text(peer_doc)
        assert conn.pending == 0  # backlog drained after reconnect

"""Integration tests for HocuspocusConnection against the real bartleby server."""

from __future__ import annotations

import asyncio

import pytest
import y_py as Y

from bartleby_tui.connection import HocuspocusConnection

pytestmark = pytest.mark.asyncio


async def test_connection_completes_initial_sync(hocuspocus_server: str) -> None:
    """The connection should reach 'synced' against an empty server doc."""
    doc = Y.YDoc()
    async with HocuspocusConnection(
        url=hocuspocus_server,
        doc_name="test-connection-sync",
        document=doc,
    ) as conn:
        await asyncio.wait_for(conn.wait_synced(), timeout=5.0)
        assert conn.is_synced


async def test_remote_update_is_visible_locally(hocuspocus_server: str) -> None:
    """A second client's insert should appear on the first client's YDoc."""
    room = f"test-remote-visible-{id(object())}"

    doc_a = Y.YDoc()
    doc_b = Y.YDoc()

    async with (
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=doc_a) as conn_a,
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=doc_b) as conn_b,
    ):
        await asyncio.wait_for(conn_a.wait_synced(), timeout=5.0)
        await asyncio.wait_for(conn_b.wait_synced(), timeout=5.0)

        # y-py 0.6 stubs don't declare YTransaction as a context manager;
        # the runtime supports it. Silenced narrowly here.
        with doc_b.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            doc_b.get_text("body").insert(txn, 0, "hello from b")

        # Give the round-trip a moment.
        for _ in range(50):
            if "hello from b" in str(doc_a.get_text("body")):
                break
            await asyncio.sleep(0.05)

        assert "hello from b" in str(doc_a.get_text("body"))


async def test_local_update_propagates_to_peer(hocuspocus_server: str) -> None:
    """A local insert should propagate to a peer connected to the same room."""
    room = f"test-local-propagates-{id(object())}"

    doc_a = Y.YDoc()
    doc_b = Y.YDoc()

    async with (
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=doc_a) as conn_a,
        HocuspocusConnection(url=hocuspocus_server, doc_name=room, document=doc_b) as conn_b,
    ):
        await asyncio.wait_for(conn_a.wait_synced(), timeout=5.0)
        await asyncio.wait_for(conn_b.wait_synced(), timeout=5.0)

        with doc_a.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            doc_a.get_text("body").insert(txn, 0, "hello from a")

        for _ in range(50):
            if "hello from a" in str(doc_b.get_text("body")):
                break
            await asyncio.sleep(0.05)

        assert "hello from a" in str(doc_b.get_text("body"))

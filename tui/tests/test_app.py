"""V-007 acceptance: textual app renders text pushed by a remote peer."""

from __future__ import annotations

import asyncio

import pytest
import y_py as Y

from bartleby_tui.app import BartlebyApp
from bartleby_tui.connection import HocuspocusConnection

pytestmark = pytest.mark.asyncio


async def test_widget_renders_after_remote_update(hocuspocus_server: str) -> None:
    room = f"app-render-{id(object())}"

    app = BartlebyApp(server_url=hocuspocus_server, doc_name=room)
    async with app.run_test() as pilot:
        # Let the app mount + complete its initial sync.
        await pilot.pause()
        for _ in range(50):
            if app.connection is not None and app.connection.is_synced:
                break
            await pilot.pause(0.05)

        assert app.connection is not None
        assert app.connection.is_synced

        # Now connect a separate peer and push some text.
        remote_doc = Y.YDoc()
        async with HocuspocusConnection(
            url=hocuspocus_server,
            doc_name=room,
            document=remote_doc,
        ) as remote:
            await asyncio.wait_for(remote.wait_synced(), timeout=5.0)
            # T-006: content lives in the prosemirror fragment now, not the
            # old flat `body` YText. The app's editor renders that fragment.
            xml = remote_doc.get_xml_element("prosemirror")
            with remote_doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
                p = xml.push_xml_element(txn, "paragraph")
                p.push_xml_text(txn).push(txn, "remote says hi")

            # Wait for the change to reach the app and rerender.
            for _ in range(50):
                rendered = app.rendered_body
                if "remote says hi" in rendered:
                    break
                await pilot.pause(0.05)

        assert "remote says hi" in app.rendered_body

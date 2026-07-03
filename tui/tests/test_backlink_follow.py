"""T-011: pressing Enter (normal mode) on a `[[backlink]]` navigates to the
linked note.

Backlink atoms are created by the web client (the TUI `[[` picker is a
deferred follow-up), so the tests build the atom directly in the YDoc. They
mount the full app with ``connect_on_mount=False`` — no websocket.
"""

from __future__ import annotations

from typing import Any

import pytest
import y_py as Y

from bartleby_tui.app import BartlebyApp
from bartleby_tui.renderer import ydoc_to_blocks

pytestmark = pytest.mark.asyncio


def _add_backlink_paragraph(doc: Y.YDoc, *, lead: str, target_id: str, title: str) -> None:
    """Append ``<paragraph>{lead}<backlink targetId title/></paragraph>``."""
    root = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        # first_child is typed YXmlElement | YXmlText; we only ever build into
        # a paragraph element here, so widen to Any for the push_xml_* calls.
        para: Any = (
            root.first_child
            if root.first_child is not None
            else root.push_xml_element(txn, "paragraph")
        )
        if lead:
            para.push_xml_text(txn).insert(txn, 0, lead)
        bl = para.push_xml_element(txn, "backlink")
        bl.set_attribute(txn, "targetId", target_id)
        bl.set_attribute(txn, "title", title)


async def test_renderer_carries_backlink_target_id() -> None:
    doc = Y.YDoc()
    root = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        root.push_xml_element(txn, "paragraph")
    _add_backlink_paragraph(doc, lead="see ", target_id="tgt-1", title="Target")

    inlines = ydoc_to_blocks(doc)[0].inlines
    backlinks = [i for i in inlines if i.atom_kind == "backlink"]
    assert backlinks and backlinks[0].target_id == "tgt-1"


async def test_enter_on_backlink_opens_target_note() -> None:
    app = BartlebyApp(connect_on_mount=False)
    async with app.run_test() as pilot:
        await pilot.pause()
        # The editor's on_mount seeded an empty paragraph (block 0); fill it.
        _add_backlink_paragraph(app._doc, lead="see ", target_id="tgt-note", title="Target")
        assert app._editor is not None
        app._editor.refresh_view()
        app._editor.focus()

        await pilot.press("escape")  # normal mode
        await pilot.press("enter")  # follow the backlink
        await pilot.pause()

        assert app._doc_name == "tgt-note"


async def test_enter_without_backlink_does_not_navigate() -> None:
    app = BartlebyApp(connect_on_mount=False, doc_name="start")
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app._editor is not None
        app._editor.focus()
        await pilot.press("escape")
        await pilot.press("enter")
        await pilot.pause()
        assert app._doc_name == "start"  # unchanged — no link to follow

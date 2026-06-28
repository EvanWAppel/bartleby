"""T-006 acceptance: each keybind of the structured editor is exercised by a
pilot test.

These mount ``StructuredEditor`` inside a tiny host App (no Hocuspocus
connection), so they run locally without the textual + live-websocket
deadlock that afflicts the full-app integration tests. Behavior is asserted
against the YDoc's ``prosemirror`` fragment via the ``ydoc_to_blocks``
contract the renderer and editing primitives share.
"""

from __future__ import annotations

import pytest
import y_py as Y
from textual.app import App, ComposeResult

from bartleby_tui import editing
from bartleby_tui.editor import StructuredEditor
from bartleby_tui.renderer import Block, ydoc_to_blocks

pytestmark = pytest.mark.asyncio


class _EditorHost(App[None]):
    """Minimal host that mounts a single focused StructuredEditor."""

    def __init__(self, doc: Y.YDoc) -> None:
        super().__init__()
        self.editor = StructuredEditor(doc, id="editor")

    def compose(self) -> ComposeResult:
        yield self.editor

    def on_mount(self) -> None:
        self.editor.focus()


def _blocks(doc: Y.YDoc) -> list[Block]:
    return ydoc_to_blocks(doc)


def _leaf_text(block: Block) -> str:
    return "".join(i.text for i in block.inlines)


# ----------------------------------------------------------------- text entry


async def test_insert_mode_types_text() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("h", "e", "l", "l", "o")
        await pilot.pause()
    assert _leaf_text(_blocks(doc)[0]) == "hello"


async def test_backspace_deletes() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("h", "i", "backspace")
        await pilot.pause()
    assert _leaf_text(_blocks(doc)[0]) == "h"


# ---------------------------------------------------------------------- modes


async def test_escape_enters_normal_and_text_is_ignored() -> None:
    doc = Y.YDoc()
    host = _EditorHost(doc)
    async with host.run_test() as pilot:
        await pilot.press("h", "i")
        await pilot.press("escape")
        assert host.editor.mode == "normal"
        await pilot.press("x", "y")  # ignored in normal mode
        await pilot.pause()
    assert _leaf_text(_blocks(doc)[0]) == "hi"


async def test_i_returns_to_insert_mode() -> None:
    doc = Y.YDoc()
    host = _EditorHost(doc)
    async with host.run_test() as pilot:
        await pilot.press("escape")
        assert host.editor.mode == "normal"
        await pilot.press("i", "y", "o")
        await pilot.pause()
    assert host.editor.mode == "insert"
    assert _leaf_text(_blocks(doc)[0]) == "yo"


# ---------------------------------------------------------------------- marks


async def test_ctrl_b_toggles_bold() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("b", "o", "l", "d")
        await pilot.press("ctrl+b")
        await pilot.pause()
    assert any("strong" in i.marks for i in _blocks(doc)[0].inlines)


async def test_ctrl_i_toggles_italic() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("i", "t")
        await pilot.press("ctrl+i")
        await pilot.pause()
    assert any("em" in i.marks for i in _blocks(doc)[0].inlines)


async def test_ctrl_x_toggles_strike() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("g", "o", "n", "e")
        await pilot.press("ctrl+x")
        await pilot.pause()
    assert any("strike" in i.marks for i in _blocks(doc)[0].inlines)


async def test_ctrl_k_link_prompt_applies_href() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("l", "i", "n", "k")
        await pilot.press("ctrl+k")
        for ch in "http://x":
            await pilot.press(ch)
        await pilot.press("enter")
        await pilot.pause()
    linked = [i for i in _blocks(doc)[0].inlines if "link" in i.marks]
    assert linked and linked[0].href == "http://x"


# -------------------------------------------------------------- block input rules


async def test_hash_space_makes_heading() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("#", "space", "T", "i", "t", "l", "e")
        await pilot.pause()
    block = _blocks(doc)[0]
    assert block.kind == "heading"
    assert block.attrs.get("level") in (1, "1")
    assert _leaf_text(block) == "Title"


async def test_double_hash_space_makes_h2() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("#", "#", "space")
        await pilot.pause()
    block = _blocks(doc)[0]
    assert block.kind == "heading"
    assert block.attrs.get("level") in (2, "2")


async def test_dash_space_makes_bullet_list() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("-", "space", "x")
        await pilot.pause()
    block = _blocks(doc)[0]
    assert block.kind == "bullet_list"
    assert block.children[0].kind == "list_item"


async def test_one_dot_space_makes_ordered_list() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("1", ".", "space")
        await pilot.pause()
    assert _blocks(doc)[0].kind == "ordered_list"


async def test_gt_space_makes_blockquote() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press(">", "space", "q")
        await pilot.pause()
    block = _blocks(doc)[0]
    assert block.kind == "blockquote"
    assert block.children[0].kind == "paragraph"


# ----------------------------------------------------------------- task toggle


async def test_space_toggles_task_at_block_start() -> None:
    doc = Y.YDoc()
    # Seed a task list directly (its creation rule is out of T-006's keybind set).
    root = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        p = root.push_xml_element(txn, "paragraph")
        p.push_xml_text(txn).insert(txn, 0, "todo")
    editing.wrap_in_list(doc, 0, "task_list")

    async with _EditorHost(doc).run_test() as pilot:
        # Caret clamps into the task item's paragraph at offset 0.
        await pilot.press("space")
        await pilot.pause()
    item = _blocks(doc)[0].children[0]
    assert item.kind == "task_item"
    assert item.attrs.get("checked") is True


async def test_space_is_literal_when_not_at_task_start() -> None:
    doc = Y.YDoc()
    async with _EditorHost(doc).run_test() as pilot:
        await pilot.press("a", "space", "b")
        await pilot.pause()
    assert _leaf_text(_blocks(doc)[0]) == "a b"

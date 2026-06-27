"""T-005 acceptance: editing primitives mutate the ProseMirror-compatible
Yjs document (the ``prosemirror`` XML fragment) and emit Yjs ops.

These are pure unit tests over a YDoc — no server. Structure is asserted
through the same ``ydoc_to_blocks`` contract the T-004 renderer consumes,
so the primitives and the renderer stay in lock-step.

Note on marks: y-py 0.6.2's ``YXmlText`` cannot carry y-prosemirror
formatting deltas (``insert`` takes no attributes, there is no ``format``).
The renderer reads marks as *node-level attributes on text-run children*,
so ``toggle_mark`` re-segments a block's inline content into per-run text
nodes carrying those attributes. This renders correctly in the TUI and is
fully testable here; cross-client mark fidelity with the web editor is a
documented limitation of the y-py version (see ``editing.py``).
"""

from __future__ import annotations

import y_py as Y

from bartleby_tui import editing
from bartleby_tui.renderer import Block, Inline, ydoc_to_blocks


def _new_doc(*kinds_and_text: tuple[str, str]) -> Y.YDoc:
    """Build a YDoc whose prosemirror fragment holds the given leaf blocks.

    Each tuple is ``(kind, text)`` — e.g. ``("paragraph", "hello")``.
    """
    doc = Y.YDoc()
    root = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        for kind, text in kinds_and_text:
            block = root.push_xml_element(txn, kind)
            if text:
                run = block.push_xml_text(txn)
                run.insert(txn, 0, text)
    return doc


def _capture_updates(doc: Y.YDoc) -> list[bytes]:
    """Record the non-empty Yjs updates the doc emits, to prove an op ran.

    y-py's ``observe_after_transaction`` also emits an empty ``b"\\x00\\x00"``
    update (no structs, no deletes) around the real change; that is observer
    noise, not a document op, so we filter it out.
    """
    updates: list[bytes] = []

    def _on_update(event: object) -> None:
        getter = getattr(event, "get_update", None)
        if callable(getter):
            update = bytes(getter())
            if update != b"\x00\x00":
                updates.append(update)

    doc.observe_after_transaction(_on_update)
    return updates


# --------------------------------------------------------------- insert_text


def test_insert_text_into_empty_paragraph() -> None:
    doc = _new_doc(("paragraph", ""))
    editing.insert_text(doc, 0, 0, "hello")
    blocks = ydoc_to_blocks(doc)
    assert blocks == [Block(kind="paragraph", inlines=[Inline(text="hello")])]


def test_insert_text_mid_run() -> None:
    doc = _new_doc(("paragraph", "helo"))
    editing.insert_text(doc, 0, 3, "l")  # he-l-o -> hello
    blocks = ydoc_to_blocks(doc)
    assert "".join(i.text for i in blocks[0].inlines) == "hello"


def test_insert_text_emits_op() -> None:
    doc = _new_doc(("paragraph", ""))
    updates = _capture_updates(doc)
    editing.insert_text(doc, 0, 0, "x")
    assert len(updates) == 1


# -------------------------------------------------------------- delete_range


def test_delete_range_within_run() -> None:
    doc = _new_doc(("paragraph", "hello world"))
    editing.delete_range(doc, 0, 5, 11)  # drop " world"
    blocks = ydoc_to_blocks(doc)
    assert "".join(i.text for i in blocks[0].inlines) == "hello"


def test_delete_range_spanning_marked_runs() -> None:
    doc = _new_doc(("paragraph", "abcdef"))
    editing.toggle_mark(doc, 0, 2, 4, "strong")  # ab[cd]ef -> 3 runs
    editing.delete_range(doc, 0, 1, 5)  # delete across all three runs -> "af"
    blocks = ydoc_to_blocks(doc)
    assert "".join(i.text for i in blocks[0].inlines) == "af"


# ---------------------------------------------------------------- toggle_mark


def test_toggle_mark_adds_mark_over_whole_block() -> None:
    doc = _new_doc(("paragraph", "bold"))
    editing.toggle_mark(doc, 0, 0, 4, "strong")
    inlines = ydoc_to_blocks(doc)[0].inlines
    assert len(inlines) == 1
    assert inlines[0].text == "bold"
    assert "strong" in inlines[0].marks


def test_toggle_mark_removes_when_already_marked() -> None:
    doc = _new_doc(("paragraph", "bold"))
    editing.toggle_mark(doc, 0, 0, 4, "strong")
    editing.toggle_mark(doc, 0, 0, 4, "strong")  # toggle off
    inlines = ydoc_to_blocks(doc)[0].inlines
    assert all("strong" not in i.marks for i in inlines)
    assert "".join(i.text for i in inlines) == "bold"


def test_toggle_mark_partial_range_splits_runs() -> None:
    doc = _new_doc(("paragraph", "abcdef"))
    editing.toggle_mark(doc, 0, 2, 4, "em")  # ab[cd]ef
    inlines = ydoc_to_blocks(doc)[0].inlines
    rebuilt = "".join(i.text for i in inlines)
    assert rebuilt == "abcdef"
    marked = [i for i in inlines if "em" in i.marks]
    assert len(marked) == 1
    assert marked[0].text == "cd"


def test_toggle_link_stores_href() -> None:
    doc = _new_doc(("paragraph", "click here"))
    editing.toggle_mark(doc, 0, 0, 5, "link", href="https://example.com")
    inlines = ydoc_to_blocks(doc)[0].inlines
    linked = [i for i in inlines if "link" in i.marks]
    assert linked and linked[0].href == "https://example.com"


# -------------------------------------------------------------- set_block_type


def test_set_block_type_paragraph_to_heading() -> None:
    doc = _new_doc(("paragraph", "Title"))
    editing.set_block_type(doc, 0, "heading", attrs={"level": 2})
    block = ydoc_to_blocks(doc)[0]
    assert block.kind == "heading"
    assert block.attrs.get("level") in (2, "2")
    assert "".join(i.text for i in block.inlines) == "Title"


def test_set_block_type_heading_back_to_paragraph() -> None:
    doc = _new_doc(("heading", "Title"))
    editing.set_block_type(doc, 0, "paragraph")
    block = ydoc_to_blocks(doc)[0]
    assert block.kind == "paragraph"
    assert "".join(i.text for i in block.inlines) == "Title"


# ---------------------------------------------------------------- wrap_in_list


def test_wrap_in_bullet_list() -> None:
    doc = _new_doc(("paragraph", "item one"))
    editing.wrap_in_list(doc, 0, "bullet_list")
    blocks = ydoc_to_blocks(doc)
    assert len(blocks) == 1
    lst = blocks[0]
    assert lst.kind == "bullet_list"
    assert len(lst.children) == 1
    item = lst.children[0]
    assert item.kind == "list_item"
    assert "".join(i.text for c in item.children for i in c.inlines) == "item one"


def test_wrap_in_task_list_creates_unchecked_task_item() -> None:
    doc = _new_doc(("paragraph", "todo"))
    editing.wrap_in_list(doc, 0, "task_list")
    lst = ydoc_to_blocks(doc)[0]
    assert lst.kind == "task_list"
    item = lst.children[0]
    assert item.kind == "task_item"
    assert item.attrs.get("checked") is False


# ----------------------------------------------------------------- toggle_task


def test_toggle_task_flips_checked() -> None:
    doc = _new_doc(("paragraph", "todo"))
    editing.wrap_in_list(doc, 0, "task_list")
    editing.toggle_task(doc, 0, 0)
    item = ydoc_to_blocks(doc)[0].children[0]
    assert item.attrs.get("checked") is True
    editing.toggle_task(doc, 0, 0)
    item = ydoc_to_blocks(doc)[0].children[0]
    assert item.attrs.get("checked") is False


def test_toggle_task_emits_op() -> None:
    doc = _new_doc(("paragraph", "todo"))
    editing.wrap_in_list(doc, 0, "task_list")
    updates = _capture_updates(doc)
    editing.toggle_task(doc, 0, 0)
    assert len(updates) == 1

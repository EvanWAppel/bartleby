"""T-005: editing primitives over the ProseMirror-compatible Yjs document.

These functions are the write-side counterpart to the T-004 renderer. They
mutate the ``prosemirror`` XML fragment of a ``y_py.YDoc`` and each emits a
single Yjs op (one transaction per call), so a peer — TUI or web — receives
the change through normal collab sync. T-006's keybinds drive these.

Six primitives, mirroring the task spec:

* ``insert_text``      — insert characters into a leaf block.
* ``delete_range``     — delete a character range within a leaf block.
* ``toggle_mark``      — toggle an inline mark (strong/em/strike/code/link).
* ``set_block_type``   — change a block's node type (e.g. paragraph↔heading).
* ``wrap_in_list``     — wrap a block in bullet/ordered/task list.
* ``toggle_task``      — flip a task_item's ``checked`` attribute.

Block addressing is by index among the fragment's top-level children;
text offsets are character offsets within a leaf block's inline content.
T-006 maps caret/selection state onto these coordinates.

Mark representation — a y-py limitation worth stating plainly. y-py 0.6.2's
``YXmlText`` cannot carry y-prosemirror formatting deltas: ``insert`` takes
no attributes and there is no ``format`` method. So a marked span is encoded
as a *separate text-run child carrying the mark as a node-level attribute* —
exactly what the T-004 renderer reads (``_collect_inlines``). ``toggle_mark``
therefore re-segments a block's inline runs. This renders correctly in the
TUI and is fully unit-tested, but the web editor (y-prosemirror) represents
marks as deltas and will not interpret these node-level attributes, so
**inline-mark fidelity does not round-trip between TUI and web**. Text,
headings, lists, and task state DO interop (they are structural, not delta
formatting). Lifting this needs a y-py/pycrdt upgrade with delta support —
tracked as a follow-up, deliberately out of T-005's scope.
"""

from __future__ import annotations

from typing import Any

import y_py as Y

# Inline marks the renderer understands. ``link`` additionally carries an
# href as its attribute value; the others are presence-only ("true").
MARKS = ("strong", "em", "strike", "code", "link")

# Truthy spellings the renderer accepts for boolean-ish string attributes.
_TRUE_VALUES = (True, "true", "True", 1, "1")


# --------------------------------------------------------------- tree helpers


def _fragment(doc: Y.YDoc, fragment_name: str) -> Any:
    return doc.get_xml_element(fragment_name)


def _child_at(parent: Any, index: int) -> Any:
    """Return the ``index``-th child of an XML node, or raise IndexError."""
    if index < 0:
        raise IndexError(f"negative child index {index}")
    child = parent.first_child
    i = 0
    while child is not None:
        if i == index:
            return child
        child = child.next_sibling
        i += 1
    raise IndexError(f"no child at index {index}")


def _child_count(node: Any) -> int:
    count = 0
    child = node.first_child
    while child is not None:
        count += 1
        child = child.next_sibling
    return count


# A block reference is either a top-level index (int) or a path of child
# indices from the fragment root down to a nested leaf (e.g. ``(0, 0, 0)``
# for list → list_item → paragraph). The structural primitives
# (set_block_type / wrap_*) only operate on top-level blocks and take an int;
# the text/mark primitives accept either so the editor caret can edit text
# inside list items and blockquotes.
BlockRef = int | tuple[int, ...]


def _resolve_block(root: Any, ref: BlockRef) -> Any:
    """Resolve a top-level index or a child-index path to its XML node."""
    if isinstance(ref, int):
        return _child_at(root, ref)
    node = root
    for index in ref:
        node = _child_at(node, index)
    return node


def _read_segments(block: Any) -> list[dict[str, Any]]:
    """Read a leaf block's inline content as an ordered list of segments.

    Text runs become ``{"kind": "text", "text": str, "marks": {k: v}}``;
    inline atom elements (backlink/mention) become
    ``{"kind": "element", "name": str, "attrs": {k: v}}`` and are preserved
    verbatim across mark re-segmentation.
    """
    segs: list[dict[str, Any]] = []
    child = block.first_child
    while child is not None:
        name = getattr(child, "name", None)
        if name is None:  # YXmlText
            segs.append(
                {
                    "kind": "text",
                    "text": str(child),
                    "marks": {k: v for k, v in child.attributes()},
                }
            )
        else:
            segs.append(
                {
                    "kind": "element",
                    "name": name,
                    "attrs": {k: v for k, v in child.attributes()},
                }
            )
        child = child.next_sibling
    return segs


def _emit_segments(txn: Any, block: Any, segs: list[dict[str, Any]]) -> None:
    """Append ``segs`` (from ``_read_segments``) as children of ``block``."""
    for seg in segs:
        if seg["kind"] == "text":
            if not seg["text"]:
                continue
            run = block.push_xml_text(txn)
            run.insert(txn, 0, seg["text"])
            for key, value in seg["marks"].items():
                run.set_attribute(txn, key, value)
        else:
            el = block.push_xml_element(txn, seg["name"])
            for key, value in seg["attrs"].items():
                el.set_attribute(txn, key, value)


# --------------------------------------------------------------- insert_text


def insert_text(
    doc: Y.YDoc,
    block_index: BlockRef,
    offset: int,
    text: str,
    *,
    fragment_name: str = "prosemirror",
) -> None:
    """Insert ``text`` at character ``offset`` within the block at ``block_index``.

    ``block_index`` is a top-level index or a child-index path to a nested
    leaf. Inserts incrementally into the existing text run that spans the
    offset, so the op is a real Yjs text insertion (preserves run identity
    and round-trips to web peers). If no text run covers the offset (e.g. an
    empty block), a new run is appended.
    """
    block = _resolve_block(_fragment(doc, fragment_name), block_index)
    target = None
    local = 0
    pos = 0
    child = block.first_child
    while child is not None:
        name = getattr(child, "name", None)
        if name is None:
            length = len(str(child))
            if offset <= pos + length:
                target, local = child, offset - pos
                break
            pos += length
        else:
            pos += 1  # inline atom occupies one position
        child = child.next_sibling

    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        if target is None:
            target = block.push_xml_text(txn)
            local = 0
        target.insert(txn, local, text)


# -------------------------------------------------------------- delete_range


def delete_range(
    doc: Y.YDoc,
    block_index: BlockRef,
    start: int,
    end: int,
    *,
    fragment_name: str = "prosemirror",
) -> None:
    """Delete characters ``[start, end)`` within the block at ``block_index``.

    ``block_index`` is a top-level index or a child-index path. Spans multiple
    text runs as needed. Inline atom nodes are skipped (their removal belongs
    to a dedicated op, not a character-range delete).
    """
    if end <= start:
        return
    block = _resolve_block(_fragment(doc, fragment_name), block_index)
    ops: list[tuple[Any, int, int]] = []
    pos = 0
    child = block.first_child
    while child is not None:
        name = getattr(child, "name", None)
        if name is None:
            length = len(str(child))
            overlap_start = max(start, pos)
            overlap_end = min(end, pos + length)
            if overlap_end > overlap_start:
                ops.append((child, overlap_start - pos, overlap_end - overlap_start))
            pos += length
        else:
            pos += 1
        child = child.next_sibling

    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        # Each run is independent, so per-run local offsets stay valid
        # regardless of deletion order.
        for run, local_start, local_len in ops:
            run.delete(txn, local_start, local_len)


# ---------------------------------------------------------------- toggle_mark


def _slice_ranges(s: int, e: int, start: int, end: int) -> list[tuple[int, int, bool]]:
    """Partition ``[s, e)`` into ``(a, b, in_range)`` pieces against ``[start, end)``."""
    cs = max(s, min(e, start))
    ce = max(s, min(e, end))
    out: list[tuple[int, int, bool]] = []
    if cs > s:
        out.append((s, cs, False))
    if ce > cs:
        out.append((cs, ce, True))
    if e > ce:
        out.append((ce, e, False))
    return out


def _range_fully_marked(segs: list[dict[str, Any]], start: int, end: int, mark: str) -> bool:
    """True if every text character in ``[start, end)`` already carries ``mark``."""
    pos = 0
    saw_text = False
    for seg in segs:
        if seg["kind"] == "element":
            pos += 1
            continue
        length = len(seg["text"])
        if min(pos + length, end) > max(pos, start):
            saw_text = True
            if mark not in seg["marks"]:
                return False
        pos += length
    return saw_text


def _coalesce(segs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge adjacent text runs with identical marks to avoid run explosion."""
    out: list[dict[str, Any]] = []
    for seg in segs:
        if (
            seg["kind"] == "text"
            and out
            and out[-1]["kind"] == "text"
            and out[-1]["marks"] == seg["marks"]
        ):
            out[-1] = {
                "kind": "text",
                "text": out[-1]["text"] + seg["text"],
                "marks": out[-1]["marks"],
            }
        else:
            out.append(seg)
    return out


def _apply_mark(
    segs: list[dict[str, Any]],
    start: int,
    end: int,
    mark: str,
    value: str,
    *,
    remove: bool,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pos = 0
    for seg in segs:
        if seg["kind"] == "element":
            out.append(seg)
            pos += 1
            continue
        text = seg["text"]
        seg_start, seg_end = pos, pos + len(text)
        for a, b, in_range in _slice_ranges(seg_start, seg_end, start, end):
            sub = text[a - seg_start : b - seg_start]
            if not sub:
                continue
            marks = dict(seg["marks"])
            if in_range:
                if remove:
                    marks.pop(mark, None)
                else:
                    marks[mark] = value
            out.append({"kind": "text", "text": sub, "marks": marks})
        pos = seg_end
    return _coalesce(out)


def toggle_mark(
    doc: Y.YDoc,
    block_index: BlockRef,
    start: int,
    end: int,
    mark: str,
    *,
    href: str | None = None,
    fragment_name: str = "prosemirror",
) -> None:
    """Toggle inline ``mark`` over ``[start, end)`` in the block at ``block_index``.

    ``block_index`` is a top-level index or a child-index path. If the whole
    range already carries the mark it is removed, otherwise it is added.
    Re-segments the block's inline runs (see module docstring on the y-py
    mark representation). For ``mark == "link"`` pass ``href`` to store the
    URL; other marks are presence-only.
    """
    if mark not in MARKS:
        raise ValueError(f"unknown mark {mark!r}; expected one of {MARKS}")
    if end <= start:
        return
    block = _resolve_block(_fragment(doc, fragment_name), block_index)
    segs = _read_segments(block)
    already = _range_fully_marked(segs, start, end, mark)
    value = href if mark == "link" and href is not None else "true"
    new_segs = _apply_mark(segs, start, end, mark, value, remove=already)

    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        existing = _child_count(block)
        if existing:
            block.delete(txn, 0, existing)
        _emit_segments(txn, block, new_segs)


# -------------------------------------------------------------- set_block_type


def set_block_type(
    doc: Y.YDoc,
    block_index: int,
    kind: str,
    *,
    attrs: dict[str, Any] | None = None,
    fragment_name: str = "prosemirror",
) -> None:
    """Replace the block at ``block_index`` with one of type ``kind``.

    y-py cannot rename an element in place, so this inserts a fresh element
    carrying the old block's inline content (and any ``attrs``, e.g.
    ``{"level": 2}`` for headings) and deletes the original.
    """
    root = _fragment(doc, fragment_name)
    block = _child_at(root, block_index)
    segs = _read_segments(block)
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        new_block = root.insert_xml_element(txn, block_index, kind)
        if attrs:
            for key, value in attrs.items():
                new_block.set_attribute(txn, key, str(value))
        _emit_segments(txn, new_block, segs)
        root.delete(txn, block_index + 1, 1)


# ---------------------------------------------------------------- wrap_in_list


def wrap_in_list(
    doc: Y.YDoc,
    block_index: int,
    list_kind: str = "bullet_list",
    *,
    fragment_name: str = "prosemirror",
) -> None:
    """Wrap the block at ``block_index`` in a list of ``list_kind``.

    ``list_kind`` is ``bullet_list``, ``ordered_list``, or ``task_list``.
    The block's inline content is moved into ``list_item``/``task_item`` >
    (original block kind). New task items start unchecked.
    """
    if list_kind not in ("bullet_list", "ordered_list", "task_list"):
        raise ValueError(f"unsupported list_kind {list_kind!r}")
    root = _fragment(doc, fragment_name)
    block = _child_at(root, block_index)
    inner_kind = block.name
    segs = _read_segments(block)
    item_kind = "task_item" if list_kind == "task_list" else "list_item"
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        lst = root.insert_xml_element(txn, block_index, list_kind)
        item = lst.push_xml_element(txn, item_kind)
        if item_kind == "task_item":
            item.set_attribute(txn, "checked", "false")
        inner = item.push_xml_element(txn, inner_kind)
        _emit_segments(txn, inner, segs)
        root.delete(txn, block_index + 1, 1)


# ------------------------------------------------------------- wrap_in_blockquote


def wrap_in_blockquote(
    doc: Y.YDoc,
    block_index: int,
    *,
    fragment_name: str = "prosemirror",
) -> None:
    """Wrap the top-level block at ``block_index`` in a ``blockquote``.

    The block's inline content is moved into ``blockquote`` > (original block
    kind), matching the ProseMirror schema (blockquote contains block-level
    children). Drives the ``> `` keybind in T-006.
    """
    root = _fragment(doc, fragment_name)
    block = _child_at(root, block_index)
    inner_kind = block.name
    segs = _read_segments(block)
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        bq = root.insert_xml_element(txn, block_index, "blockquote")
        inner = bq.push_xml_element(txn, inner_kind)
        _emit_segments(txn, inner, segs)
        root.delete(txn, block_index + 1, 1)


# ----------------------------------------------------------------- toggle_task


def toggle_task(
    doc: Y.YDoc,
    block_index: int,
    item_index: int = 0,
    *,
    fragment_name: str = "prosemirror",
) -> None:
    """Flip the ``checked`` attribute of the ``item_index``-th task_item.

    ``block_index`` addresses the ``task_list``; ``item_index`` selects the
    task_item within it (default first).
    """
    root = _fragment(doc, fragment_name)
    lst = _child_at(root, block_index)
    item = _child_at(lst, item_index)
    attrs = {k: v for k, v in item.attributes()}
    is_checked = attrs.get("checked") in _TRUE_VALUES
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        item.set_attribute(txn, "checked", "false" if is_checked else "true")


# ----------------------------------------------------------------- insert_atom


def _split_and_insert(
    segs: list[dict[str, Any]], offset: int, atom: dict[str, Any]
) -> list[dict[str, Any]]:
    """Insert ``atom`` at character ``offset``, splitting a text run if needed.

    Atoms count as length 1 (matching the caret model); text runs split.
    """
    out: list[dict[str, Any]] = []
    pos = 0
    inserted = False
    for seg in segs:
        if seg["kind"] == "text":
            length = len(seg["text"])
            if not inserted and pos <= offset <= pos + length:
                local = offset - pos
                if local > 0:
                    out.append(
                        {"kind": "text", "text": seg["text"][:local], "marks": dict(seg["marks"])}
                    )
                out.append(atom)
                if local < length:
                    out.append(
                        {"kind": "text", "text": seg["text"][local:], "marks": dict(seg["marks"])}
                    )
                inserted = True
            else:
                out.append(seg)
            pos += length
        else:
            if not inserted and offset == pos:
                out.append(atom)
                inserted = True
            out.append(seg)
            pos += 1
    if not inserted:
        out.append(atom)
    return out


def insert_atom(
    doc: Y.YDoc,
    block_index: BlockRef,
    offset: int,
    name: str,
    attrs: dict[str, Any],
    *,
    fragment_name: str = "prosemirror",
) -> None:
    """Insert an inline atom element (``backlink``/``mention``) at ``offset``.

    The atom occupies one caret position. Mirrors the web atom nodes
    (backlink: ``targetId``/``title``; mention: ``email``/``displayName``)
    so they interop. Re-emits the block's inline runs (like ``toggle_mark``).
    """
    block = _resolve_block(_fragment(doc, fragment_name), block_index)
    segs = _read_segments(block)
    new_segs = _split_and_insert(
        segs, offset, {"kind": "element", "name": name, "attrs": dict(attrs)}
    )
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        existing = _child_count(block)
        if existing:
            block.delete(txn, 0, existing)
        _emit_segments(txn, block, new_segs)

"""T-004 acceptance: ProseMirror-style document renderer.

One test per node type (the spec's "snapshot per node type"). For
each node type we construct a small intermediate-tree fixture, run the
renderer, and assert key structural properties of the result. We
deliberately avoid byte-for-byte snapshots because rich's ANSI output
is verbose, brittle, and not the property under test — what matters is
that headings carry the bold style, list items carry their markers,
blockquotes carry their left bar, code blocks render as a panel, etc.

A second group of tests covers the y_py adapter, building a YDoc with
the matching XmlElement shape and confirming the adapter walks it into
the same Block tree the renderer consumes.
"""

from __future__ import annotations

import pytest
import y_py as Y
from rich.console import Console, Group
from rich.panel import Panel
from rich.text import Text

from bartleby_tui.renderer import (
    Block,
    Inline,
    render_document,
    ydoc_to_blocks,
)


def _to_plain(renderable: object) -> str:
    """Render any renderable to a plain (ANSI-stripped) string."""
    console = Console(file=None, width=120, record=True)
    console.print(renderable, end="")
    return console.export_text(clear=True)


# ---------------------------------------------------------------- per node type


def test_renderer_paragraph_outputs_text() -> None:
    blocks = [Block(kind="paragraph", inlines=[Inline(text="hello world")])]
    rendered = render_document(blocks)
    assert "hello world" in _to_plain(rendered)


@pytest.mark.parametrize("level", [1, 2, 3, 4, 5, 6])
def test_renderer_headings_h1_h6_are_bold_with_tag(level: int) -> None:
    """All heading levels render with the appropriate `#…` tag and bold style."""
    blocks = [
        Block(
            kind="heading",
            inlines=[Inline(text="Title")],
            attrs={"level": level},
        )
    ]
    rendered = render_document(blocks)
    plain = _to_plain(rendered)
    assert "Title" in plain
    assert ("#" * level) in plain
    # Must be wrapped in a rich.Text with bold styling.
    assert isinstance(rendered, Group)
    heading_text = rendered.renderables[0]
    assert isinstance(heading_text, Text)
    # Bold lives in the .style attribute or in spans; assert presence.
    assert "bold" in str(heading_text.style) or any(
        "bold" in str(span.style) for span in heading_text.spans
    )


def test_renderer_bold_mark_produces_bold_span() -> None:
    blocks = [
        Block(
            kind="paragraph",
            inlines=[Inline(text="bold", marks=frozenset({"strong"}))],
        )
    ]
    rendered = render_document(blocks)
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    assert any("bold" in str(span.style) for span in text.spans)


def test_renderer_italic_mark_produces_italic_span() -> None:
    blocks = [
        Block(
            kind="paragraph",
            inlines=[Inline(text="emph", marks=frozenset({"em"}))],
        )
    ]
    rendered = render_document(blocks)
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    assert any("italic" in str(span.style) for span in text.spans)


def test_renderer_strike_mark_produces_strike_span() -> None:
    blocks = [
        Block(
            kind="paragraph",
            inlines=[Inline(text="gone", marks=frozenset({"strike"}))],
        )
    ]
    rendered = render_document(blocks)
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    assert any("strike" in str(span.style) for span in text.spans)


def test_renderer_link_mark_is_underlined_and_footnoted() -> None:
    blocks = [
        Block(
            kind="paragraph",
            inlines=[
                Inline(text="see "),
                Inline(
                    text="here",
                    marks=frozenset({"link"}),
                    href="https://example.com",
                ),
            ],
        )
    ]
    rendered = render_document(blocks)
    plain = _to_plain(rendered)
    # Footnote marker appears inline and the URL appears in the footnote.
    assert "[1]" in plain
    assert "https://example.com" in plain
    # Inline link run should be underlined.
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    assert any("underline" in str(span.style) for span in text.spans)


def test_renderer_bullet_list_emits_bullet_markers() -> None:
    blocks = [
        Block(
            kind="bullet_list",
            children=[
                Block(
                    kind="list_item",
                    children=[Block(kind="paragraph", inlines=[Inline(text="alpha")])],
                ),
                Block(
                    kind="list_item",
                    children=[Block(kind="paragraph", inlines=[Inline(text="beta")])],
                ),
            ],
        )
    ]
    rendered = render_document(blocks)
    plain = _to_plain(rendered)
    assert "• alpha" in plain
    assert "• beta" in plain


def test_renderer_ordered_list_numbers_each_item() -> None:
    blocks = [
        Block(
            kind="ordered_list",
            children=[
                Block(
                    kind="list_item",
                    children=[Block(kind="paragraph", inlines=[Inline(text="first")])],
                ),
                Block(
                    kind="list_item",
                    children=[Block(kind="paragraph", inlines=[Inline(text="second")])],
                ),
                Block(
                    kind="list_item",
                    children=[Block(kind="paragraph", inlines=[Inline(text="third")])],
                ),
            ],
        )
    ]
    rendered = render_document(blocks)
    plain = _to_plain(rendered)
    assert "1. first" in plain
    assert "2. second" in plain
    assert "3. third" in plain


def test_renderer_blockquote_has_left_bar() -> None:
    blocks = [
        Block(
            kind="blockquote",
            children=[Block(kind="paragraph", inlines=[Inline(text="quoted")])],
        )
    ]
    rendered = render_document(blocks)
    plain = _to_plain(rendered)
    # PRD: blockquote uses a left bar marker.
    assert "▎" in plain
    assert "quoted" in plain


def test_renderer_task_list_unchecked_and_checked_markers() -> None:
    blocks = [
        Block(
            kind="task_list",
            children=[
                Block(
                    kind="task_item",
                    attrs={"checked": False},
                    children=[Block(kind="paragraph", inlines=[Inline(text="todo")])],
                ),
                Block(
                    kind="task_item",
                    attrs={"checked": True},
                    children=[Block(kind="paragraph", inlines=[Inline(text="done")])],
                ),
            ],
        )
    ]
    rendered = render_document(blocks)
    plain = _to_plain(rendered)
    assert "[ ] todo" in plain
    assert "[x] done" in plain


def test_renderer_code_block_is_bordered_panel() -> None:
    blocks = [
        Block(
            kind="code_block",
            inlines=[Inline(text="print('hi')\n")],
            attrs={"language": "python"},
        )
    ]
    rendered = render_document(blocks)
    assert isinstance(rendered, Group)
    panel = rendered.renderables[0]
    assert isinstance(panel, Panel)
    plain = _to_plain(rendered)
    # Content appears, and language is surfaced (used as panel title).
    assert "print('hi')" in plain
    assert "python" in plain


def test_renderer_code_block_default_language_omits_title() -> None:
    """A code block with default 'text' language has no title (still bordered)."""
    blocks = [
        Block(
            kind="code_block",
            inlines=[Inline(text="hello")],
            attrs={"language": "text"},
        )
    ]
    rendered = render_document(blocks)
    panel = rendered.renderables[0]
    assert isinstance(panel, Panel)
    assert panel.title is None


def test_renderer_backlink_atom_renders_double_brackets_with_color() -> None:
    blocks = [
        Block(
            kind="paragraph",
            inlines=[
                Inline(text="see "),
                Inline(text="[[Other Note]]", atom_kind="backlink"),
            ],
        )
    ]
    rendered = render_document(blocks)
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    assert "[[Other Note]]" in _to_plain(rendered)
    # backlink style includes a distinct color so it stands out.
    assert any("cyan" in str(span.style) for span in text.spans)


def test_renderer_mention_atom_renders_at_sign_with_color() -> None:
    blocks = [
        Block(
            kind="paragraph",
            inlines=[
                Inline(text="cc "),
                Inline(text="@alice", atom_kind="mention"),
            ],
        )
    ]
    rendered = render_document(blocks)
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    assert "@alice" in _to_plain(rendered)
    assert any("magenta" in str(span.style) for span in text.spans)


def test_renderer_combined_marks_emit_multiple_styles() -> None:
    """A run with both strong + em should be bold and italic."""
    blocks = [
        Block(
            kind="paragraph",
            inlines=[Inline(text="bi", marks=frozenset({"strong", "em"}))],
        )
    ]
    rendered = render_document(blocks)
    text = rendered.renderables[0]
    assert isinstance(text, Text)
    styles = " ".join(str(span.style) for span in text.spans)
    assert "bold" in styles
    assert "italic" in styles


def test_renderer_empty_document_produces_empty_group() -> None:
    rendered = render_document([])
    assert isinstance(rendered, Group)
    assert list(rendered.renderables) == []


# ---------------------------------------------------------------- YDoc adapter


def test_adapter_paragraph_with_text() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        p = xml.push_xml_element(txn, "paragraph")
        t = p.push_xml_text(txn)
        t.push(txn, "hello adapter")

    blocks = ydoc_to_blocks(doc)
    assert len(blocks) == 1
    assert blocks[0].kind == "paragraph"
    assert blocks[0].inlines[0].text == "hello adapter"


def test_adapter_heading_extracts_level_attr() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        h = xml.push_xml_element(txn, "heading")
        h.set_attribute(txn, "level", "3")
        h.push_xml_text(txn).push(txn, "Section")

    blocks = ydoc_to_blocks(doc)
    assert len(blocks) == 1
    assert blocks[0].kind == "heading"
    assert blocks[0].attrs.get("level") == "3"
    # And the renderer accepts it.
    plain = _to_plain(render_document(blocks))
    assert "### Section" in plain


def test_adapter_blockquote_with_nested_paragraph() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        bq = xml.push_xml_element(txn, "blockquote")
        p = bq.push_xml_element(txn, "paragraph")
        p.push_xml_text(txn).push(txn, "quoted")

    blocks = ydoc_to_blocks(doc)
    assert blocks[0].kind == "blockquote"
    assert blocks[0].children[0].kind == "paragraph"
    plain = _to_plain(render_document(blocks))
    assert "▎" in plain
    assert "quoted" in plain


def test_adapter_code_block_carries_language() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        cb = xml.push_xml_element(txn, "code_block")
        cb.set_attribute(txn, "language", "rust")
        cb.push_xml_text(txn).push(txn, "fn main() {}")

    blocks = ydoc_to_blocks(doc)
    assert blocks[0].kind == "code_block"
    assert blocks[0].attrs.get("language") == "rust"


def test_adapter_bullet_list_walks_items() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        ul = xml.push_xml_element(txn, "bullet_list")
        for label in ("one", "two"):
            li = ul.push_xml_element(txn, "list_item")
            p = li.push_xml_element(txn, "paragraph")
            p.push_xml_text(txn).push(txn, label)

    blocks = ydoc_to_blocks(doc)
    assert blocks[0].kind == "bullet_list"
    assert len(blocks[0].children) == 2
    plain = _to_plain(render_document(blocks))
    assert "• one" in plain
    assert "• two" in plain


def test_adapter_task_list_extracts_checked_attr() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        tl = xml.push_xml_element(txn, "task_list")
        ti_done = tl.push_xml_element(txn, "task_item")
        ti_done.set_attribute(txn, "checked", "true")
        p1 = ti_done.push_xml_element(txn, "paragraph")
        p1.push_xml_text(txn).push(txn, "done item")
        ti_todo = tl.push_xml_element(txn, "task_item")
        # default checked=false (omitted attribute)
        p2 = ti_todo.push_xml_element(txn, "paragraph")
        p2.push_xml_text(txn).push(txn, "todo item")

    blocks = ydoc_to_blocks(doc)
    assert blocks[0].kind == "task_list"
    assert blocks[0].children[0].attrs.get("checked") is True
    assert blocks[0].children[1].attrs.get("checked", False) is False
    plain = _to_plain(render_document(blocks))
    assert "[x] done item" in plain
    assert "[ ] todo item" in plain


def test_adapter_backlink_atom_node_is_parsed() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        p = xml.push_xml_element(txn, "paragraph")
        p.push_xml_text(txn).push(txn, "see ")
        bl = p.push_xml_element(txn, "backlink")
        bl.set_attribute(txn, "title", "Other Note")
        bl.set_attribute(txn, "targetId", "note-id-1")

    blocks = ydoc_to_blocks(doc)
    para = blocks[0]
    assert para.kind == "paragraph"
    atoms = [i for i in para.inlines if i.atom_kind == "backlink"]
    assert len(atoms) == 1
    assert atoms[0].text == "[[Other Note]]"


def test_adapter_mention_atom_node_is_parsed() -> None:
    doc = Y.YDoc()
    xml = doc.get_xml_element("prosemirror")
    with doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
        p = xml.push_xml_element(txn, "paragraph")
        p.push_xml_text(txn).push(txn, "cc ")
        m = p.push_xml_element(txn, "mention")
        m.set_attribute(txn, "email", "alice@example.com")
        m.set_attribute(txn, "displayName", "Alice")

    blocks = ydoc_to_blocks(doc)
    atoms = [i for i in blocks[0].inlines if i.atom_kind == "mention"]
    assert len(atoms) == 1
    assert atoms[0].text == "@Alice"

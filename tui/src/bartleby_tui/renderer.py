"""ProseMirror-style document renderer for the Bartleby TUI (T-004).

Walks a ProseMirror-compatible tree (paragraph, heading, list, blockquote,
code_block, task_list, etc.) and produces a `rich` renderable suitable for
display in a Textual widget (e.g. ``RichLog`` or ``Static``).

The renderer is split in two pieces:

1. A tiny tree representation (``Block`` + ``Inline`` dataclasses) that
   mirrors the ProseMirror schema in ``server/src/derived/schema.ts`` /
   ``web/src/lib/editor/schema.ts``. This is what the renderer consumes.

2. An adapter (``ydoc_to_blocks``) that walks a ``y_py.YXmlElement`` /
   ``y_py.YXmlText`` tree (the live representation in the Yjs document
   under the ``"prosemirror"`` fragment) and produces the intermediate
   tree. y-py 0.6 does not expose ProseMirror-style inline mark deltas
   on ``YXmlText``; we fall back to whole-text-run attributes where
   available. The intermediate representation lets the renderer be
   exercised in tests without depending on that limitation.

Code block syntax highlighting (T-025) tokenizes the block via pygments
(by its ``language`` attribute) into styled Rich Text; ``text``/unknown
languages render unstyled. The bordered panel + language-title shape is
unchanged.

Footnotes for links: each `link` mark on inline text emits a numbered
superscript-like marker (e.g. ``[1]``) inline, and the renderer collects
the URLs into a footnote list rendered at the bottom of the document.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from pygments import lex
from pygments.lexers import get_lexer_by_name
from pygments.token import Comment, Keyword, Name, Number, Operator, String, _TokenType
from pygments.util import ClassNotFound
from rich import box
from rich.console import Group, RenderableType
from rich.panel import Panel
from rich.text import Text

if TYPE_CHECKING:
    import y_py as Y

log = logging.getLogger(__name__)


# ---------------------------------------------------------------- intermediate tree
#
# These classes are deliberately not "real" ProseMirror nodes — they only
# carry the bits the TUI renderer needs. Keep them dict-shaped so test
# fixtures can be hand-written quickly.

MarkName = str  # 'strong' | 'em' | 'strike' | 'link' | 'code'


@dataclass(frozen=True)
class Inline:
    """Inline content: text plus a set of marks and optional link href.

    Atom inline nodes (backlink / mention) use ``atom_kind`` to indicate
    they should be styled differently. The ``text`` field is what gets
    rendered (e.g. the backlink title or mention display name).
    """

    text: str
    marks: frozenset[MarkName] = frozenset()
    href: str | None = None  # populated when 'link' is in marks
    atom_kind: str | None = None  # 'backlink' | 'mention' | None
    target_id: str | None = None  # backlink atom's target note id (T-011 follow)


@dataclass
class Block:
    """Block-level node. ``kind`` is the PM node type name.

    ``children`` carries child *blocks* (e.g. list_item, nested
    blockquote). ``inlines`` carries inline content for leaf blocks
    (paragraph, heading, code_block). The two fields are mutually
    exclusive in practice but we keep both for simplicity.

    ``attrs`` carries node attributes — e.g. heading.level,
    code_block.language, task_item.checked.
    """

    kind: str
    inlines: list[Inline] = field(default_factory=list)
    children: list[Block] = field(default_factory=list)
    attrs: dict[str, object] = field(default_factory=dict)


# ---------------------------------------------------------------- styles

# Marks → Rich style flags. See https://rich.readthedocs.io/en/stable/style.html
_MARK_STYLE: dict[MarkName, str] = {
    "strong": "bold",
    "em": "italic",
    "strike": "strike",
    "code": "reverse",  # inline code: a visible swap to set it apart
}

# Distinct colors for special inline atoms. Bright_blue for links keeps
# parity with how most terminals render hyperlinks; backlinks and
# mentions get their own hues so they're scannable in the buffer.
_LINK_STYLE = "underline bright_blue"
_BACKLINK_STYLE = "bold cyan"
_MENTION_STYLE = "bold magenta"

# Heading prefix used to set headings apart visually. Textual / rich
# don't support genuine font sizing in a terminal; the PRD only asks
# that H1-H6 be distinguishable, which uppercase + bold + a leading
# tag achieves.
_HEADING_TAG = {1: "#", 2: "##", 3: "###", 4: "####", 5: "#####", 6: "######"}


# ---------------------------------------------------------------- inline rendering


def _inline_style(inline: Inline) -> str:
    """Compose a rich style string for an Inline run."""
    parts: list[str] = []
    if inline.atom_kind == "backlink":
        parts.append(_BACKLINK_STYLE)
    elif inline.atom_kind == "mention":
        parts.append(_MENTION_STYLE)
    if "link" in inline.marks:
        parts.append(_LINK_STYLE)
    for mark in inline.marks:
        style = _MARK_STYLE.get(mark)
        if style is not None:
            parts.append(style)
    return " ".join(parts)


def _render_inlines(
    inlines: list[Inline],
    footnotes: list[str],
) -> Text:
    """Render a sequence of Inline runs to a single rich Text.

    Side effect: appends discovered link hrefs to ``footnotes`` and
    inserts ``[N]`` markers inline after each linked run so the reader
    can cross-reference. Backlinks/mentions are styled but not
    footnoted (they don't carry an external URL).
    """
    out = Text()
    for inline in inlines:
        style = _inline_style(inline)
        out.append(inline.text, style=style or None)
        if "link" in inline.marks and inline.href:
            footnotes.append(inline.href)
            marker = f"[{len(footnotes)}]"
            out.append(marker, style="dim")
    return out


# ---------------------------------------------------------------- block rendering


def _render_paragraph(block: Block, footnotes: list[str]) -> RenderableType:
    return _render_inlines(block.inlines, footnotes)


def _render_heading(block: Block, footnotes: list[str]) -> RenderableType:
    raw_level = block.attrs.get("level", 1)
    if isinstance(raw_level, (int, str)):
        try:
            level = int(raw_level)
        except ValueError:
            level = 1
    else:
        level = 1
    level = max(1, min(6, level))
    tag = _HEADING_TAG[level]

    text = Text(f"{tag} ", style="bold")
    text.append(_render_inlines(block.inlines, footnotes))
    text.stylize("bold")
    return text


def _render_blockquote(block: Block, footnotes: list[str]) -> RenderableType:
    """Render a blockquote with a left-bar marker (PRD "left bar")."""
    inner = _render_children(block, footnotes)
    # Build a Panel with only a left edge. rich.box.Box doesn't have a
    # built-in left-only box, so we prefix each line with ▎ which is a
    # widely-supported "left bar" glyph that reads as a quote rail.
    bar = Text()
    rendered = _flatten_to_text(inner)
    for i, line in enumerate(rendered.split("\n")):
        if i > 0:
            bar.append("\n")
        bar.append("▎ ", style="bright_black")
        bar.append(line)
    return bar


# T-025: pygments token type → Rich style. Lookups walk a token's parent
# chain (e.g. ``Keyword.Namespace`` → ``Keyword``) so subtypes inherit. Colors
# are coarse on purpose — enough to be scannable in a terminal, stable enough
# for tests to assert on.
_TOKEN_STYLES: dict[_TokenType, str] = {
    Keyword: "bold magenta",
    Name.Function: "blue",
    Name.Class: "bold blue",
    Name.Builtin: "cyan",
    String: "green",
    Number: "cyan",
    Comment: "dim italic",
    Operator: "yellow",
}


def _style_for_token(token_type: _TokenType) -> str | None:
    node: _TokenType | None = token_type
    while node is not None:
        style = _TOKEN_STYLES.get(node)
        if style is not None:
            return style
        node = node.parent
    return None


def _highlight_code(code: str, language: str) -> Text:
    """Tokenize ``code`` with pygments and return styled Rich Text.

    Unknown languages (no pygments lexer) fall back to unstyled text so the
    panel still renders. Errors from pygments propagate per agents.md.
    """
    try:
        lexer = get_lexer_by_name(language)
    except ClassNotFound:
        log.debug("no pygments lexer for %r; rendering code unstyled", language)
        return Text(code)
    text = Text()
    for token_type, value in lex(code, lexer):
        text.append(value, style=_style_for_token(token_type))
    text.rstrip()  # pygments appends a trailing newline token
    return text


def _render_code_block(block: Block, _footnotes: list[str]) -> RenderableType:
    language = str(block.attrs.get("language", "text") or "text")
    code = "".join(inline.text for inline in block.inlines)
    # Code blocks don't carry marks (schema: ``marks: ''``). For a real
    # language, syntax-highlight via pygments (T-025); plain ``text`` stays
    # unstyled. The rounded panel + language title shape is unchanged.
    text = Text(code) if language == "text" else _highlight_code(code, language)
    title = language if language != "text" else None
    return Panel(text, box=box.ROUNDED, title=title, title_align="right", expand=False)


def _render_bullet_list(block: Block, footnotes: list[str]) -> RenderableType:
    items: list[RenderableType] = []
    for child in block.children:
        # Each child is a list_item; render its content with a leading
        # bullet. list_item.children are blocks (paragraphs etc.) — we
        # render them and indent.
        item_render = _render_children(child, footnotes)
        items.append(_indent_with_marker("• ", item_render))
    return Group(*items)


def _render_ordered_list(block: Block, footnotes: list[str]) -> RenderableType:
    items: list[RenderableType] = []
    start_raw = block.attrs.get("order", 1)
    if isinstance(start_raw, (int, str)):
        try:
            start = int(start_raw)
        except ValueError:
            start = 1
    else:
        start = 1
    for index, child in enumerate(block.children):
        marker = f"{start + index}. "
        item_render = _render_children(child, footnotes)
        items.append(_indent_with_marker(marker, item_render))
    return Group(*items)


def _render_task_list(block: Block, footnotes: list[str]) -> RenderableType:
    items: list[RenderableType] = []
    for child in block.children:
        if child.kind != "task_item":
            # Stray non-task children: render with a neutral marker so
            # nothing is silently dropped.
            items.append(_indent_with_marker("  ", _render_children(child, footnotes)))
            continue
        checked = bool(child.attrs.get("checked", False))
        marker = "[x] " if checked else "[ ] "
        item_render = _render_children(child, footnotes)
        items.append(_indent_with_marker(marker, item_render))
    return Group(*items)


def _render_list_item(block: Block, footnotes: list[str]) -> RenderableType:
    # A bare list_item rendered by itself (rare — usually wrapped in a
    # list) just renders its children.
    return _render_children(block, footnotes)


# Dispatch table for block kinds.
_BLOCK_RENDERERS = {
    "paragraph": _render_paragraph,
    "heading": _render_heading,
    "blockquote": _render_blockquote,
    "code_block": _render_code_block,
    "bullet_list": _render_bullet_list,
    "ordered_list": _render_ordered_list,
    "task_list": _render_task_list,
    "task_item": _render_list_item,
    "list_item": _render_list_item,
}


def _render_block(block: Block, footnotes: list[str]) -> RenderableType:
    renderer = _BLOCK_RENDERERS.get(block.kind)
    if renderer is None:
        log.warning("renderer: unknown block kind %r; falling back to text", block.kind)
        return _render_inlines(block.inlines, footnotes)
    return renderer(block, footnotes)


def _render_children(block: Block, footnotes: list[str]) -> RenderableType:
    """Render either ``block.children`` (blocks) or ``block.inlines`` (text)."""
    if block.children:
        rendered = [_render_block(child, footnotes) for child in block.children]
        return Group(*rendered)
    return _render_inlines(block.inlines, footnotes)


# ---------------------------------------------------------------- helpers


def _indent_with_marker(marker: str, renderable: RenderableType) -> Text:
    """Prefix the first line of ``renderable`` with ``marker``; indent the rest.

    Used by list rendering to attach `• ` / `1. ` / `[ ]` markers
    without dragging in rich.tree's heavier styling (which doesn't
    cleanly nest arbitrary renderables).
    """
    body = _flatten_to_text(renderable)
    pad = " " * len(marker)
    out = Text()
    lines = body.split("\n")
    for i, line in enumerate(lines):
        if i > 0:
            out.append("\n")
        out.append(marker if i == 0 else pad)
        out.append(line)
    return out


def _flatten_to_text(renderable: RenderableType) -> Text:
    """Best-effort conversion of any renderable to a single rich.Text.

    Used inside list rendering so the marker can be prefixed to each
    line. For Group/Text inputs we preserve styles; for other types
    (Panel et al) we fall back to a plain string capture.
    """
    if isinstance(renderable, Text):
        return renderable
    if isinstance(renderable, Group):
        out = Text()
        first = True
        for r in renderable.renderables:
            piece = _flatten_to_text(r)
            if not first:
                out.append("\n")
            out.append(piece)
            first = False
        return out
    # Fallback: render via a Console to a string. This loses styles but
    # keeps content visible — important so unknown future renderables
    # don't silently disappear from list items.
    from rich.console import Console

    console = Console(file=None, width=80, record=True)
    console.print(renderable, end="")
    return Text(console.export_text(clear=True).rstrip("\n"))


# ---------------------------------------------------------------- public API


def render_document(blocks: list[Block]) -> Group:
    """Render a list of top-level blocks to a single Rich Group.

    Collects link footnotes during rendering and appends a numbered
    footnote section at the bottom of the document when any links
    were encountered. The Group return type lets callers index into
    ``.renderables`` (used by tests for per-node assertions and by
    DocumentRenderer for layout).
    """
    footnotes: list[str] = []
    parts: list[RenderableType] = []
    for block in blocks:
        parts.append(_render_block(block, footnotes))
    if footnotes:
        fn_text = Text()
        fn_text.append("\n")
        for idx, href in enumerate(footnotes, start=1):
            if idx > 1:
                fn_text.append("\n")
            fn_text.append(f"[{idx}] ", style="dim")
            fn_text.append(href, style=_LINK_STYLE)
        parts.append(fn_text)
    return Group(*parts)


# ---------------------------------------------------------------- YDoc adapter
#
# Convert a y_py XmlFragment (the canonical PM holder) into the
# intermediate Block tree. y-py 0.6 doesn't expose inline mark deltas
# on YXmlText, so for live docs marks are reduced to whole-text-run
# attributes pulled off the YXmlText itself. The intermediate tree
# keeps tests independent of this limitation.


_ATOM_KINDS = {"backlink", "mention"}


def ydoc_to_blocks(ydoc: Y.YDoc, fragment_name: str = "prosemirror") -> list[Block]:
    """Adapter: walk the YDoc's prosemirror XML fragment into Block tree."""
    import y_py as Y  # local import keeps the renderer pure-rich at top-level

    root = ydoc.get_xml_element(fragment_name)
    blocks: list[Block] = []
    child = root.first_child
    while child is not None:
        block = _yxml_to_block(child)
        if block is not None:
            blocks.append(block)
        child = child.next_sibling
    _ = Y  # keep the import live for the typing reference
    return blocks


def _yxml_to_block(node: object) -> Block | None:
    """Convert one YXmlElement to a Block."""
    name = getattr(node, "name", None)
    if name is None:
        # YXmlText at top level: wrap as a paragraph so its content
        # isn't lost.
        text = str(node)
        if not text:
            return None
        return Block(kind="paragraph", inlines=[Inline(text=text)])

    attrs = _yxml_attributes(node)

    # Leaf blocks (paragraph, heading, code_block) carry inline content.
    if name in ("paragraph", "heading", "code_block"):
        return Block(kind=name, inlines=_collect_inlines(node), attrs=attrs)

    # Container blocks (blockquote, list, list_item, task_list, task_item).
    children: list[Block] = []
    child = getattr(node, "first_child", None)
    while child is not None:
        cb = _yxml_to_block(child)
        if cb is not None:
            children.append(cb)
        child = child.next_sibling
    return Block(kind=name, children=children, attrs=attrs)


def _yxml_attributes(node: object) -> dict[str, object]:
    """Pull attributes off a YXmlElement as a plain dict.

    y-py exposes attributes as a sequence of (key, value) pairs via
    ``.attributes()``. Values come back as strings; callers that want
    typed values (heading level, task checked) convert in the renderer.
    """
    attrs_iter = getattr(node, "attributes", None)
    if attrs_iter is None:
        return {}
    try:
        pairs = list(attrs_iter())
    except TypeError:
        return {}
    out: dict[str, object] = {}
    for key, value in pairs:
        if key == "checked":
            out[key] = value in (True, "true", "True", 1, "1")
        else:
            out[key] = value
    return out


def _collect_inlines(parent: object) -> list[Inline]:
    """Walk a leaf block's children, collecting Inline runs."""
    inlines: list[Inline] = []
    child = getattr(parent, "first_child", None)
    while child is not None:
        name = getattr(child, "name", None)
        if name is None:
            # YXmlText
            text = str(child)
            if text:
                attrs = _yxml_attributes(child)
                marks: set[str] = set()
                href: str | None = None
                for mark in ("strong", "em", "strike", "code"):
                    if mark in attrs:
                        marks.add(mark)
                if "link" in attrs:
                    marks.add("link")
                    href_val = attrs.get("link")
                    href = href_val if isinstance(href_val, str) else None
                inlines.append(Inline(text=text, marks=frozenset(marks), href=href))
        elif name in _ATOM_KINDS:
            atom_attrs = _yxml_attributes(child)
            if name == "backlink":
                title = atom_attrs.get("title", "")
                target = atom_attrs.get("targetId")
                inlines.append(
                    Inline(
                        text=f"[[{title}]]" if title else "[[]]",
                        atom_kind="backlink",
                        target_id=target if isinstance(target, str) else None,
                    )
                )
            elif name == "mention":
                display = atom_attrs.get("displayName") or atom_attrs.get("email") or ""
                inlines.append(
                    Inline(
                        text=f"@{display}",
                        atom_kind="mention",
                    )
                )
        child = child.next_sibling
    return inlines

"""T-006: structured editing surface for the Bartleby TUI.

``StructuredEditor`` replaces the V-008 flat-text ``BodyEditor``. It edits the
ProseMirror-compatible ``prosemirror`` XML fragment directly through the T-005
``editing`` primitives — the same fragment the web client (y-prosemirror)
uses — so TUI edits actually reach web peers' editors (the old ``body`` YText
was TUI-only and invisible to the web).

The widget renders the document with the T-004 ``render_document`` renderer,
overlaid with a caret marker, and dispatches keystrokes:

* **Modes (vim-flavored):** insert by default (typing inserts text), ``Esc``
  to normal mode, ``i`` back to insert.
* **Marks:** ``Ctrl-B`` bold, ``Ctrl-I`` italic, ``Ctrl-Shift-X`` strike —
  toggled over the current block's text. ``Ctrl-K`` opens an inline link
  prompt that toggles a ``link`` mark with the typed URL.
* **Block input rules (insert mode, at the start of a top-level block):**
  ``# ``/``## ``/``### `` → heading, ``- `` → bullet list, ``1. `` → ordered
  list, ``> `` → blockquote.
* **Tasks:** ``Space`` at offset 0 of a task item toggles its checkbox
  (mirrors W-010's web convention); elsewhere ``Space`` is a literal space.

Caret model (v1): a path to a leaf block (``paragraph``/``heading``/
``code_block``) plus a character offset; horizontal/vertical movement walks
the flattened, in-document-order list of leaf blocks. Deliberately scoped for
this PR: ``Enter`` starts a fresh top-level paragraph (no mid-text split);
mark toggles cover the whole current block (no selection model yet); inline
atoms (backlinks/mentions) are not counted in caret math (the TUI can't yet
create them — the ``[[``/``@`` pickers are a follow-up). These are noted so
the follow-up that adds selections + pickers knows what to extend.
"""

from __future__ import annotations

import logging
from dataclasses import replace

import y_py as Y
from rich.console import Group
from rich.text import Text
from textual import events
from textual.message import Message
from textual.widgets import Static

from bartleby_tui import editing
from bartleby_tui.renderer import Block, Inline, render_document, ydoc_to_blocks

log = logging.getLogger(__name__)

#: Block kinds that carry editable inline text (caret can land in them).
LEAF_KINDS = frozenset({"paragraph", "heading", "code_block"})

#: Visible caret glyph spliced into the rendered text at the caret offset.
CARET_GLYPH = "▏"

#: Block input rules: trigger text typed at the start of a top-level block,
#: completed by Space. Maps trigger → (action, argument).
_INPUT_RULES: dict[str, tuple[str, int | None]] = {
    "#": ("heading", 1),
    "##": ("heading", 2),
    "###": ("heading", 3),
    "-": ("bullet_list", None),
    "1.": ("ordered_list", None),
    ">": ("blockquote", None),
}

MODE_INSERT = "insert"
MODE_NORMAL = "normal"


def _leaf_paths(blocks: list[Block], prefix: tuple[int, ...] = ()) -> list[tuple[int, ...]]:
    """Flatten the block tree to an in-order list of paths to leaf blocks."""
    out: list[tuple[int, ...]] = []
    for i, block in enumerate(blocks):
        path = (*prefix, i)
        if block.kind in LEAF_KINDS:
            out.append(path)
        else:
            out.extend(_leaf_paths(block.children, path))
    return out


def _block_at_path(blocks: list[Block], path: tuple[int, ...]) -> Block | None:
    """Resolve a path to its Block in a rendered tree, or None if invalid."""
    node: Block | None = None
    children = blocks
    for index in path:
        if index < 0 or index >= len(children):
            return None
        node = children[index]
        children = node.children
    return node


def _leaf_text_len(leaf: Block) -> int:
    """Editable character length of a leaf: its text runs (atoms excluded)."""
    return sum(len(inline.text) for inline in leaf.inlines if inline.atom_kind is None)


class StructuredEditor(Static):
    """Editable, caret-bearing view over a YDoc's ``prosemirror`` fragment."""

    can_focus = True

    class SearchRequested(Message):
        """Posted when the user presses ``/`` in normal mode (T-008 search)."""

    class TagFilterRequested(Message):
        """Posted when the user presses ``t`` in normal mode (T-009 tag filter)."""

    class NewNoteRequested(Message):
        """Posted on ``n`` in normal mode (T-010 new note)."""

    class RenameRequested(Message):
        """Posted on ``r`` in normal mode (T-010 rename current note)."""

    class DeleteRequested(Message):
        """Posted on ``d`` in normal mode (T-010 delete current note)."""

    class RestoreRequested(Message):
        """Posted on ``R`` in normal mode (T-010 restore last-deleted note)."""

    class BacklinkFollowRequested(Message):
        """Posted on Enter (normal mode) over a ``[[backlink]]`` (T-011 follow)."""

        def __init__(self, target_id: str) -> None:
            super().__init__()
            self.target_id = target_id

    class HelpRequested(Message):
        """Posted on ``?`` in normal mode (T-020 help overlay)."""

    DEFAULT_CSS = """
    StructuredEditor {
        height: 1fr;
        padding: 1 2;
    }
    """

    def __init__(self, doc: Y.YDoc, *, id: str | None = None) -> None:
        super().__init__("", id=id)
        self._doc = doc
        self._caret_path: tuple[int, ...] = (0,)
        self._caret_offset: int = 0
        self._mode: str = MODE_INSERT
        # When not None we're capturing a URL for a Ctrl-K link toggle.
        self._link_buffer: str | None = None

    # --------------------------------------------------------------- lifecycle

    def on_mount(self) -> None:
        self._ensure_block_exists()
        self.refresh_view()

    # ------------------------------------------------------------- public-ish

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def caret(self) -> tuple[tuple[int, ...], int]:
        return (self._caret_path, self._caret_offset)

    def set_doc(self, doc: Y.YDoc) -> None:
        """Point the editor at a different YDoc (used when opening a note).

        Resets the caret to the document start and repaints. The caller owns
        the connection lifecycle; this only swaps what the widget edits.
        """
        self._doc = doc
        self._caret_path = (0,)
        self._caret_offset = 0
        self._link_buffer = None
        self._ensure_block_exists()
        self.refresh_view()

    def refresh_view(self) -> None:
        """Repaint from the YDoc, overlaying the caret and a mode line."""
        blocks = ydoc_to_blocks(self._doc)
        self._clamp_caret(blocks)
        self._inject_caret(blocks)
        body = render_document(blocks)
        self.update(Group(body, self._status_line()))

    # ------------------------------------------------------------- key events

    def on_key(self, event: events.Key) -> None:
        if self._link_buffer is not None:
            self._handle_link_key(event)
            return

        # Mark toggles + link entry work in both modes (Ctrl chords).
        if event.key == "ctrl+b":
            self._toggle_mark("strong")
        elif event.key == "ctrl+i":
            self._toggle_mark("em")
        elif event.key == "ctrl+x":
            # Terminals can't reliably encode Ctrl-Shift-X distinctly from
            # Ctrl-X; we bind strike to what the terminal actually delivers.
            self._toggle_mark("strike")
        elif event.key == "ctrl+k":
            self._link_buffer = ""
        elif event.key == "escape":
            self._mode = MODE_NORMAL
        elif self._mode == MODE_NORMAL:
            self._handle_normal_key(event)
        else:
            self._handle_insert_key(event)

        event.stop()
        event.prevent_default()
        self.refresh_view()

    def _handle_normal_key(self, event: events.Key) -> None:
        key = event.key
        if key == "i":
            self._mode = MODE_INSERT
        elif key == "slash":
            # vim-style search: only in normal mode, so insert-mode `/` stays
            # a literal slash. The app owns the search UI.
            self.post_message(self.SearchRequested())
        elif key == "t":
            # Tag filter picker (T-009); normal mode only so insert-mode `t`
            # types a literal "t". The app owns the picker UI.
            self.post_message(self.TagFilterRequested())
        elif key == "n":
            self.post_message(self.NewNoteRequested())  # T-010 new note
        elif key == "r":
            self.post_message(self.RenameRequested())  # T-010 rename
        elif key == "d":
            self.post_message(self.DeleteRequested())  # T-010 delete
        elif key == "R":  # Shift-R
            self.post_message(self.RestoreRequested())  # T-010 restore
        elif key == "enter":
            # T-011: Enter over a [[backlink]] follows it to the linked note.
            target = self._backlink_near_caret()
            if target is not None:
                self.post_message(self.BacklinkFollowRequested(target))
        elif key == "question_mark":
            self.post_message(self.HelpRequested())  # T-020 help overlay
        elif key in ("left", "h"):
            self._move_horizontal(-1)
        elif key in ("right", "l"):
            self._move_horizontal(1)
        elif key in ("up", "k"):
            self._move_vertical(-1)
        elif key in ("down", "j"):
            self._move_vertical(1)

    def _handle_insert_key(self, event: events.Key) -> None:
        key = event.key
        if key == "left":
            self._move_horizontal(-1)
        elif key == "right":
            self._move_horizontal(1)
        elif key == "up":
            self._move_vertical(-1)
        elif key == "down":
            self._move_vertical(1)
        elif key == "backspace":
            self._backspace()
        elif key == "enter":
            self._enter()
        elif key == "space":
            self._handle_space()
        elif event.is_printable and event.character is not None:
            self._insert_text(event.character)

    # --------------------------------------------------------------- editing

    def _insert_text(self, text: str) -> None:
        editing.insert_text(self._doc, self._caret_path, self._caret_offset, text)
        self._caret_offset += len(text)

    def _backspace(self) -> None:
        if self._caret_offset > 0:
            editing.delete_range(
                self._doc, self._caret_path, self._caret_offset - 1, self._caret_offset
            )
            self._caret_offset -= 1
        else:
            self._move_horizontal(-1)

    def _enter(self) -> None:
        """Start a fresh empty paragraph after the current top-level block."""
        top = self._caret_path[0]
        root = self._doc.get_xml_element("prosemirror")
        with self._doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            root.insert_xml_element(txn, top + 1, "paragraph")
        self._caret_path = (top + 1,)
        self._caret_offset = 0

    def _handle_space(self) -> None:
        blocks = ydoc_to_blocks(self._doc)
        task = self._task_context(blocks)
        if task is not None and self._caret_offset == 0:
            editing.toggle_task(self._doc, task[0], task[1])
            return
        if self._apply_input_rule(blocks):
            return
        self._insert_text(" ")

    def _apply_input_rule(self, blocks: list[Block]) -> bool:
        """If the current top-level block is a completed trigger, transform it."""
        if len(self._caret_path) != 1:
            return False
        leaf = _block_at_path(blocks, self._caret_path)
        if leaf is None:
            return False
        text = "".join(i.text for i in leaf.inlines if i.atom_kind is None)
        if self._caret_offset != len(text):
            return False
        rule = _INPUT_RULES.get(text)
        if rule is None:
            return False

        top = self._caret_path[0]
        editing.delete_range(self._doc, self._caret_path, 0, len(text))
        action, arg = rule
        if action == "heading":
            editing.set_block_type(self._doc, top, "heading", attrs={"level": arg})
            self._caret_path = (top,)
        elif action in ("bullet_list", "ordered_list"):
            editing.wrap_in_list(self._doc, top, action)
            self._caret_path = (top, 0, 0)
        elif action == "blockquote":
            editing.wrap_in_blockquote(self._doc, top)
            self._caret_path = (top, 0)
        self._caret_offset = 0
        return True

    def _backlink_near_caret(self) -> str | None:
        """Target id of the backlink at/after the caret in the current leaf.

        Caret offsets count text only; atoms are length 1 here purely to order
        the candidates. Picks the first backlink at or after the caret, else
        the last one in the block — so Enter anywhere on a line with a single
        link follows it. Precise per-atom selection is a follow-up (it needs an
        atom-aware caret, deferred with the `[[` picker).
        """
        blocks = ydoc_to_blocks(self._doc)
        leaf = _block_at_path(blocks, self._caret_path)
        if leaf is None:
            return None
        pos = 0
        candidates: list[tuple[int, str]] = []
        for inline in leaf.inlines:
            if inline.atom_kind == "backlink" and inline.target_id:
                candidates.append((pos, inline.target_id))
            pos += len(inline.text) if inline.atom_kind is None else 1
        if not candidates:
            return None
        for start, target in candidates:
            if start >= self._caret_offset:
                return target
        return candidates[-1][1]

    def _toggle_mark(self, mark: str, *, href: str | None = None) -> None:
        blocks = ydoc_to_blocks(self._doc)
        leaf = _block_at_path(blocks, self._caret_path)
        if leaf is None:
            return
        length = _leaf_text_len(leaf)
        if length == 0:
            return
        editing.toggle_mark(self._doc, self._caret_path, 0, length, mark, href=href)

    # ----------------------------------------------------------- link sub-mode

    def _handle_link_key(self, event: events.Key) -> None:
        if event.key == "escape":
            self._link_buffer = None
        elif event.key == "enter":
            href = self._link_buffer or ""
            self._link_buffer = None
            if href:
                self._toggle_mark("link", href=href)
        elif event.key == "backspace":
            self._link_buffer = (self._link_buffer or "")[:-1]
        elif event.is_printable and event.character is not None:
            self._link_buffer = (self._link_buffer or "") + event.character
        event.stop()
        event.prevent_default()
        self.refresh_view()

    # --------------------------------------------------------------- movement

    def _move_horizontal(self, delta: int) -> None:
        blocks = ydoc_to_blocks(self._doc)
        leaves = _leaf_paths(blocks)
        if not leaves:
            return
        index = self._current_leaf_index(leaves)
        leaf = _block_at_path(blocks, leaves[index])
        leaf_len = _leaf_text_len(leaf) if leaf is not None else 0
        if delta > 0:
            if self._caret_offset < leaf_len:
                self._caret_offset += 1
            elif index + 1 < len(leaves):
                self._caret_path = leaves[index + 1]
                self._caret_offset = 0
        else:
            if self._caret_offset > 0:
                self._caret_offset -= 1
            elif index > 0:
                self._caret_path = leaves[index - 1]
                prev = _block_at_path(blocks, leaves[index - 1])
                self._caret_offset = _leaf_text_len(prev) if prev is not None else 0

    def _move_vertical(self, delta: int) -> None:
        blocks = ydoc_to_blocks(self._doc)
        leaves = _leaf_paths(blocks)
        if not leaves:
            return
        index = self._current_leaf_index(leaves)
        target = max(0, min(len(leaves) - 1, index + delta))
        self._caret_path = leaves[target]
        leaf = _block_at_path(blocks, leaves[target])
        self._caret_offset = min(self._caret_offset, _leaf_text_len(leaf) if leaf else 0)

    def _current_leaf_index(self, leaves: list[tuple[int, ...]]) -> int:
        try:
            return leaves.index(self._caret_path)
        except ValueError:
            return 0

    # --------------------------------------------------------------- helpers

    def _task_context(self, blocks: list[Block]) -> tuple[int, int] | None:
        """Return ``(task_list_index, item_index)`` if the caret is in a task."""
        if len(self._caret_path) < 2:
            return None
        top = self._caret_path[0]
        if top >= len(blocks) or blocks[top].kind != "task_list":
            return None
        return (top, self._caret_path[1])

    def _ensure_block_exists(self) -> None:
        """Guarantee at least one editable block so the caret has a home."""
        root = self._doc.get_xml_element("prosemirror")
        if root.first_child is not None:
            return
        with self._doc.begin_transaction() as txn:  # ty: ignore[invalid-context-manager]
            root.push_xml_element(txn, "paragraph")

    def _clamp_caret(self, blocks: list[Block]) -> None:
        """Keep the caret on a valid leaf + in-range offset after any change."""
        leaves = _leaf_paths(blocks)
        if not leaves:
            self._caret_path = (0,)
            self._caret_offset = 0
            return
        if self._caret_path not in leaves:
            self._caret_path = leaves[min(self._current_leaf_index(leaves), len(leaves) - 1)]
        leaf = _block_at_path(blocks, self._caret_path)
        self._caret_offset = max(0, min(self._caret_offset, _leaf_text_len(leaf) if leaf else 0))

    def _inject_caret(self, blocks: list[Block]) -> None:
        """Splice the caret glyph into the caret leaf's inlines at the offset."""
        leaf = _block_at_path(blocks, self._caret_path)
        if leaf is None:
            return
        caret = Inline(text=CARET_GLYPH)
        new_inlines: list[Inline] = []
        pos = 0
        inserted = False
        for inline in leaf.inlines:
            length = len(inline.text)
            if not inserted and inline.atom_kind is None and self._caret_offset <= pos + length:
                local = self._caret_offset - pos
                if local > 0:
                    new_inlines.append(replace(inline, text=inline.text[:local]))
                new_inlines.append(caret)
                if local < length:
                    new_inlines.append(replace(inline, text=inline.text[local:]))
                inserted = True
            else:
                new_inlines.append(inline)
            pos += length
        if not inserted:
            new_inlines.append(caret)
        leaf.inlines = new_inlines

    def _status_line(self) -> Text:
        if self._link_buffer is not None:
            return Text(f"link > {self._link_buffer}", style="bold yellow")
        label = "INSERT" if self._mode == MODE_INSERT else "NORMAL"
        return Text(f"-- {label} --", style="dim")

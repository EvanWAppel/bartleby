"""Right-pane widgets (Workstream T pane cluster).

``BacklinksPane`` (T-012) lists the notes that link to the current note; the
app toggles it with the ``g b`` chord and selecting a row opens the source.
Later panes (comments, history, …) join this module.
"""

from __future__ import annotations

from textual import events
from textual.message import Message
from textual.widgets import OptionList
from textual.widgets.option_list import Option

from bartleby_tui.notes_api import Backlink, Comment, Mention, Note, Snapshot


class BacklinksPane(OptionList):
    """Inbound-links list. One row per source note; option id == source id."""

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._backlinks: tuple[Backlink, ...] = ()

    @property
    def backlinks(self) -> tuple[Backlink, ...]:
        return self._backlinks

    def set_backlinks(self, backlinks: list[Backlink] | tuple[Backlink, ...]) -> None:
        """Replace the rendered inbound links."""
        self._backlinks = tuple(backlinks)
        self.clear_options()
        for link in self._backlinks:
            title = link.source_title or "(untitled)"
            self.add_option(Option(title, id=link.source_id))


class TrashPane(OptionList):
    """Trashed-notes list (T-016). ``R`` restores, ``D`` deletes forever."""

    class RestoreRequested(Message):
        def __init__(self, note_id: str) -> None:
            super().__init__()
            self.note_id = note_id

    class DeleteForeverRequested(Message):
        def __init__(self, note_id: str) -> None:
            super().__init__()
            self.note_id = note_id

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._notes: tuple[Note, ...] = ()

    @property
    def notes(self) -> tuple[Note, ...]:
        return self._notes

    def set_notes(self, notes: list[Note] | tuple[Note, ...]) -> None:
        self._notes = tuple(notes)
        self.clear_options()
        for note in self._notes:
            self.add_option(Option(note.title or "(untitled)", id=note.id))

    def _highlighted_id(self) -> str | None:
        if self.highlighted is None:
            return None
        return self.get_option_at_index(self.highlighted).id

    def on_key(self, event: events.Key) -> None:
        # Shift-R / Shift-D act on the highlighted trashed note.
        if event.key == "R":
            note_id = self._highlighted_id()
            if note_id is not None:
                event.stop()
                event.prevent_default()
                self.post_message(self.RestoreRequested(note_id))
        elif event.key == "D":
            note_id = self._highlighted_id()
            if note_id is not None:
                event.stop()
                event.prevent_default()
                self.post_message(self.DeleteForeverRequested(note_id))


class MentionsPane(OptionList):
    """Inbox of @mentions (T-017). Option id == mention id; ``●`` marks unread."""

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._mentions: tuple[Mention, ...] = ()

    @property
    def mentions(self) -> tuple[Mention, ...]:
        return self._mentions

    @property
    def unread_count(self) -> int:
        return sum(1 for m in self._mentions if m.read_at is None)

    def mention_for(self, mention_id: str) -> Mention | None:
        return next((m for m in self._mentions if m.id == mention_id), None)

    def set_mentions(self, mentions: list[Mention] | tuple[Mention, ...]) -> None:
        self._mentions = tuple(mentions)
        self.clear_options()
        for mention in self._mentions:
            marker = "● " if mention.read_at is None else "  "
            label = f"{marker}{mention.note_title or '(untitled)'}"
            if mention.source:
                label += f"  {mention.source}"
            self.add_option(Option(label, id=mention.id))


class SnapshotsPane(OptionList):
    """History list (T-015). Option id == snapshot id; Enter restores."""

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._snapshots: tuple[Snapshot, ...] = ()

    @property
    def snapshots(self) -> tuple[Snapshot, ...]:
        return self._snapshots

    def snapshot_for(self, snapshot_id: str) -> Snapshot | None:
        return next((s for s in self._snapshots if s.id == snapshot_id), None)

    def set_snapshots(self, snapshots: list[Snapshot] | tuple[Snapshot, ...]) -> None:
        self._snapshots = tuple(snapshots)
        self.clear_options()
        for snap in self._snapshots:
            label = snap.label if snap.label else "auto"
            self.add_option(Option(f"{label}  {snap.created_at}", id=snap.id))


class CommentsPane(OptionList):
    """Comment threads (T-013/T-014). One row per root (``○``/``✓`` =
    open/resolved); Enter expands to show replies. ``c`` new, ``r`` reply,
    ``x`` resolve act on the highlighted root."""

    class NewCommentRequested(Message):
        """Posted on ``c`` — compose a new top-level comment."""

    class ReplyRequested(Message):
        def __init__(self, comment_id: str) -> None:
            super().__init__()
            self.comment_id = comment_id

    class ResolveRequested(Message):
        def __init__(self, comment_id: str) -> None:
            super().__init__()
            self.comment_id = comment_id

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._comments: tuple[Comment, ...] = ()
        self._expanded: set[str] = set()

    @property
    def comments(self) -> tuple[Comment, ...]:
        return self._comments

    @property
    def expanded(self) -> set[str]:
        return set(self._expanded)

    def set_comments(self, comments: list[Comment] | tuple[Comment, ...]) -> None:
        self._comments = tuple(comments)
        self._expanded &= {c.id for c in self._comments}  # drop stale ids
        self._rebuild()

    def expand(self, comment_id: str) -> None:
        """Mark a thread expanded (so its replies show on the next rebuild)."""
        self._expanded.add(comment_id)

    def _roots(self) -> list[Comment]:
        return [c for c in self._comments if c.parent_comment_id is None]

    def _replies_of(self, root_id: str) -> list[Comment]:
        return [c for c in self._comments if c.parent_comment_id == root_id]

    def _rebuild(self) -> None:
        self.clear_options()
        for root in self._roots():
            marker = "✓" if root.resolved_at else "○"
            replies = self._replies_of(root.id)
            suffix = f"  [{len(replies)}]" if replies else ""
            self.add_option(Option(f"{marker} {root.body}{suffix}", id=f"c:{root.id}"))
            if root.id in self._expanded:
                for reply in replies:
                    self.add_option(Option(f"    ↳ {reply.body}", id=f"r:{reply.id}"))

    def _highlighted_root_id(self) -> str | None:
        if self.highlighted is None:
            return None
        option_id = self.get_option_at_index(self.highlighted).id
        if option_id is not None and option_id.startswith("c:"):
            return option_id[2:]
        return None

    def on_key(self, event: events.Key) -> None:
        if event.key == "c":
            event.stop()
            event.prevent_default()
            self.post_message(self.NewCommentRequested())
            return
        if event.key in ("r", "x", "enter"):
            root_id = self._highlighted_root_id()
            if root_id is None:
                return
            event.stop()
            event.prevent_default()
            if event.key == "r":
                self.post_message(self.ReplyRequested(root_id))
            elif event.key == "x":
                self.post_message(self.ResolveRequested(root_id))
            else:  # enter → expand / collapse
                self._expanded ^= {root_id}
                self._rebuild()

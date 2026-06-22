import type { Database } from 'better-sqlite3';
import type { CommentRow } from './types.js';

export interface CommentInsert {
  id: string;
  note_id: string;
  author_id: string;
  parent_comment_id: string | null;
  anchor: string;
  original_quote: string;
  body: string;
  created_at: string;
}

export interface CommentsRepository {
  insert(c: CommentInsert): CommentRow;
  findById(id: string): CommentRow | undefined;
  listByNote(noteId: string, opts?: { includeResolved?: boolean }): CommentRow[];
  /** C-008: every comment for the note, resolved or not. The orphan-
   * recompute pass touches the whole set so resolved threads still get
   * their flag refreshed when content gets restored. */
  listAllByNote(noteId: string): CommentRow[];
  resolve(id: string, resolvedAt: string): void;
  reopen(id: string): void;
  /** C-008: denormalized orphan flag. Toggle from the S-009 hook after
   * recomputing anchor resolvability against the live YDoc. */
  setOrphaned(id: string, orphaned: boolean): void;
  delete(id: string): void;
}

// SQLite returns INTEGER columns as JS numbers. The wire DTO + every
// downstream caller wants a JS boolean, so coerce at the boundary.
interface RawCommentRow {
  id: string;
  note_id: string;
  author_id: string;
  parent_comment_id: string | null;
  anchor: string;
  original_quote: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
  is_orphaned: number;
}

function hydrate(raw: RawCommentRow): CommentRow {
  return {
    id: raw.id,
    note_id: raw.note_id,
    author_id: raw.author_id,
    parent_comment_id: raw.parent_comment_id,
    anchor: raw.anchor,
    original_quote: raw.original_quote,
    body: raw.body,
    created_at: raw.created_at,
    resolved_at: raw.resolved_at,
    is_orphaned: raw.is_orphaned === 1,
  };
}

export function createCommentsRepository(db: Database): CommentsRepository {
  const insertStmt = db.prepare(
    `INSERT INTO comments
       (id, note_id, author_id, parent_comment_id, anchor, original_quote, body, created_at, resolved_at, is_orphaned)
     VALUES (@id, @note_id, @author_id, @parent_comment_id, @anchor, @original_quote, @body, @created_at, NULL, 0)`,
  );
  const findByIdStmt = db.prepare<[string], RawCommentRow>(`SELECT * FROM comments WHERE id = ?`);
  const listAllStmt = db.prepare<[string], RawCommentRow>(
    `SELECT * FROM comments WHERE note_id = ? ORDER BY created_at, id`,
  );
  const listOpenStmt = db.prepare<[string], RawCommentRow>(
    `SELECT * FROM comments WHERE note_id = ? AND resolved_at IS NULL ORDER BY created_at, id`,
  );
  const resolveStmt = db.prepare(`UPDATE comments SET resolved_at = ? WHERE id = ?`);
  const reopenStmt = db.prepare(`UPDATE comments SET resolved_at = NULL WHERE id = ?`);
  const setOrphanedStmt = db.prepare(`UPDATE comments SET is_orphaned = ? WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM comments WHERE id = ?`);

  return {
    insert(c) {
      insertStmt.run(c);
      const row = findByIdStmt.get(c.id);
      if (!row) {
        throw new Error(`comment ${c.id} not visible after insert`);
      }
      return hydrate(row);
    },
    findById: (id) => {
      const row = findByIdStmt.get(id);
      return row === undefined ? undefined : hydrate(row);
    },
    listByNote: (noteId, opts) =>
      (opts?.includeResolved ? listAllStmt.all(noteId) : listOpenStmt.all(noteId)).map(hydrate),
    listAllByNote: (noteId) => listAllStmt.all(noteId).map(hydrate),
    resolve: (id, at) => {
      resolveStmt.run(at, id);
    },
    reopen: (id) => {
      reopenStmt.run(id);
    },
    setOrphaned: (id, orphaned) => {
      setOrphanedStmt.run(orphaned ? 1 : 0, id);
    },
    delete: (id) => {
      deleteStmt.run(id);
    },
  };
}

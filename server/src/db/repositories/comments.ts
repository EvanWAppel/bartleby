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
  resolve(id: string, resolvedAt: string): void;
  reopen(id: string): void;
  delete(id: string): void;
}

export function createCommentsRepository(db: Database): CommentsRepository {
  const insertStmt = db.prepare(
    `INSERT INTO comments
       (id, note_id, author_id, parent_comment_id, anchor, original_quote, body, created_at, resolved_at)
     VALUES (@id, @note_id, @author_id, @parent_comment_id, @anchor, @original_quote, @body, @created_at, NULL)`,
  );
  const findByIdStmt = db.prepare<[string], CommentRow>(`SELECT * FROM comments WHERE id = ?`);
  const listAllStmt = db.prepare<[string], CommentRow>(
    `SELECT * FROM comments WHERE note_id = ? ORDER BY created_at, id`,
  );
  const listOpenStmt = db.prepare<[string], CommentRow>(
    `SELECT * FROM comments WHERE note_id = ? AND resolved_at IS NULL ORDER BY created_at, id`,
  );
  const resolveStmt = db.prepare(`UPDATE comments SET resolved_at = ? WHERE id = ?`);
  const reopenStmt = db.prepare(`UPDATE comments SET resolved_at = NULL WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM comments WHERE id = ?`);

  return {
    insert(c) {
      insertStmt.run(c);
      const row = findByIdStmt.get(c.id);
      if (!row) {
        throw new Error(`comment ${c.id} not visible after insert`);
      }
      return row;
    },
    findById: (id) => findByIdStmt.get(id),
    listByNote: (noteId, opts) =>
      opts?.includeResolved ? listAllStmt.all(noteId) : listOpenStmt.all(noteId),
    resolve: (id, at) => {
      resolveStmt.run(at, id);
    },
    reopen: (id) => {
      reopenStmt.run(id);
    },
    delete: (id) => {
      deleteStmt.run(id);
    },
  };
}

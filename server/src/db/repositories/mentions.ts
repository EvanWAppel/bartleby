import type { Database } from 'better-sqlite3';
import type { MentionRow } from './types.js';

export interface MentionInsert {
  id: string;
  note_id: string;
  mentioned_user_id: string;
  mentioning_user_id: string;
  source: string;
  created_at: string;
}

export interface MentionsRepository {
  insert(m: MentionInsert): MentionRow;
  findById(id: string): MentionRow | undefined;
  listForUser(userId: string, opts?: { unread?: boolean }): MentionRow[];
  /** M-001: every mention attributed to a note (any source) — used to
   * dedupe before inserting a fresh batch from a re-extracted markdown
   * body. */
  listForNote(noteId: string, opts?: { source?: string }): MentionRow[];
  markRead(id: string, readAt: string): void;
  listPendingEmail(): MentionRow[];
  markEmailSent(ids: string[], at: string): void;
}

export function createMentionsRepository(db: Database): MentionsRepository {
  const insertStmt = db.prepare(
    `INSERT INTO mentions
       (id, note_id, mentioned_user_id, mentioning_user_id, source, created_at, read_at, email_sent_at)
     VALUES (@id, @note_id, @mentioned_user_id, @mentioning_user_id, @source, @created_at, NULL, NULL)`,
  );
  const findByIdStmt = db.prepare<[string], MentionRow>(`SELECT * FROM mentions WHERE id = ?`);
  const listAllForUserStmt = db.prepare<[string], MentionRow>(
    `SELECT * FROM mentions WHERE mentioned_user_id = ? ORDER BY created_at DESC, id`,
  );
  const listUnreadForUserStmt = db.prepare<[string], MentionRow>(
    `SELECT * FROM mentions
     WHERE mentioned_user_id = ? AND read_at IS NULL
     ORDER BY created_at DESC, id`,
  );
  const markReadStmt = db.prepare(`UPDATE mentions SET read_at = ? WHERE id = ?`);
  const listPendingEmailStmt = db.prepare<[], MentionRow>(
    `SELECT * FROM mentions WHERE email_sent_at IS NULL ORDER BY created_at, id`,
  );
  const listForNoteStmt = db.prepare<[string], MentionRow>(
    `SELECT * FROM mentions WHERE note_id = ? ORDER BY created_at, id`,
  );
  const listForNoteAndSourceStmt = db.prepare<[string, string], MentionRow>(
    `SELECT * FROM mentions WHERE note_id = ? AND source = ? ORDER BY created_at, id`,
  );

  return {
    insert(m) {
      insertStmt.run(m);
      const row = findByIdStmt.get(m.id);
      if (!row) {
        throw new Error(`mention ${m.id} not visible after insert`);
      }
      return row;
    },
    findById: (id) => findByIdStmt.get(id),
    listForUser: (userId, opts) =>
      opts?.unread ? listUnreadForUserStmt.all(userId) : listAllForUserStmt.all(userId),
    listForNote: (noteId, opts) =>
      opts?.source !== undefined
        ? listForNoteAndSourceStmt.all(noteId, opts.source)
        : listForNoteStmt.all(noteId),
    markRead: (id, at) => {
      markReadStmt.run(at, id);
    },
    listPendingEmail: () => listPendingEmailStmt.all(),
    markEmailSent: (ids, at) => {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`UPDATE mentions SET email_sent_at = ? WHERE id IN (${placeholders})`).run(
        at,
        ...ids,
      );
    },
  };
}

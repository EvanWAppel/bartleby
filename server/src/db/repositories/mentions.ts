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
  listForUser(userId: string, opts?: { unread?: boolean }): MentionRow[];
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

  return {
    insert(m) {
      insertStmt.run(m);
      const row = findByIdStmt.get(m.id);
      if (!row) {
        throw new Error(`mention ${m.id} not visible after insert`);
      }
      return row;
    },
    listForUser: (userId, opts) =>
      opts?.unread ? listUnreadForUserStmt.all(userId) : listAllForUserStmt.all(userId),
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

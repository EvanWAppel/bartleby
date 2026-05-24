import type { Database } from 'better-sqlite3';
import type { SnapshotRow } from './types.js';

export interface SnapshotInsert {
  id: string;
  note_id: string;
  yjs_state: Buffer;
  created_at: string;
  label: string | null;
}

export interface SnapshotsRepository {
  insert(s: SnapshotInsert): SnapshotRow;
  findById(id: string): SnapshotRow | undefined;
  listByNote(noteId: string, opts?: { limit?: number; offset?: number }): SnapshotRow[];
  pruneAutoSnapshots(noteId: string, keep: number): number;
}

export function createSnapshotsRepository(db: Database): SnapshotsRepository {
  const insertStmt = db.prepare(
    `INSERT INTO snapshots (id, note_id, yjs_state, created_at, label)
     VALUES (@id, @note_id, @yjs_state, @created_at, @label)`,
  );
  const findByIdStmt = db.prepare<[string], SnapshotRow>(`SELECT * FROM snapshots WHERE id = ?`);
  const listByNoteStmt = db.prepare<[string, number, number], SnapshotRow>(
    `SELECT * FROM snapshots WHERE note_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  );

  return {
    insert(s) {
      insertStmt.run(s);
      const row = findByIdStmt.get(s.id);
      if (!row) {
        throw new Error(`snapshot ${s.id} not visible after insert`);
      }
      return row;
    },
    findById: (id) => findByIdStmt.get(id),
    listByNote: (noteId, opts) => {
      const limit = opts?.limit ?? -1;
      const offset = opts?.offset ?? 0;
      return listByNoteStmt.all(noteId, limit, offset);
    },
    pruneAutoSnapshots(noteId, keep) {
      const ids = db
        .prepare<[string, number], { id: string }>(
          `SELECT id FROM snapshots
           WHERE note_id = ? AND label IS NULL
           ORDER BY created_at DESC
           LIMIT -1 OFFSET ?`,
        )
        .all(noteId, keep)
        .map((r) => r.id);

      if (ids.length === 0) return 0;

      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`);
      const result = stmt.run(...ids);
      return Number(result.changes);
    },
  };
}

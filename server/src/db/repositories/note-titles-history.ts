import type { Database } from 'better-sqlite3';
import type { NoteTitleHistoryRow } from './types.js';

export interface TitleResolution {
  note_id: string;
  is_current: boolean;
}

export interface NoteTitlesHistoryRepository {
  append(noteId: string, title: string, validFrom: string): void;
  listByNote(noteId: string): NoteTitleHistoryRow[];
  resolveTitle(title: string): TitleResolution[];
}

export function createNoteTitlesHistoryRepository(db: Database): NoteTitlesHistoryRepository {
  const closeOpenStmt = db.prepare(
    `UPDATE note_titles_history SET valid_to = ?
     WHERE note_id = ? AND valid_to IS NULL`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO note_titles_history (note_id, title, valid_from, valid_to)
     VALUES (?, ?, ?, NULL)`,
  );
  const listByNoteStmt = db.prepare<[string], NoteTitleHistoryRow>(
    `SELECT * FROM note_titles_history WHERE note_id = ? ORDER BY valid_from`,
  );
  const resolveTitleStmt = db.prepare<[string], { note_id: string; valid_to: string | null }>(
    `SELECT note_id, valid_to FROM note_titles_history
     WHERE title = ?
     ORDER BY valid_to IS NULL DESC, valid_from DESC`,
  );

  const appendTxn = db.transaction((noteId: string, title: string, validFrom: string) => {
    closeOpenStmt.run(validFrom, noteId);
    insertStmt.run(noteId, title, validFrom);
  });

  return {
    append: (noteId, title, validFrom) => appendTxn(noteId, title, validFrom),
    listByNote: (noteId) => listByNoteStmt.all(noteId),
    resolveTitle: (title) =>
      resolveTitleStmt.all(title).map((r) => ({
        note_id: r.note_id,
        is_current: r.valid_to === null,
      })),
  };
}

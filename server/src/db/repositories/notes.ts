import type { Database } from 'better-sqlite3';
import type { NoteRow } from './types.js';

export interface NotesRepository {
  insert(note: NoteRow): NoteRow;
  findById(id: string): NoteRow | undefined;
  listLive(): NoteRow[];
  listTrashed(): NoteRow[];
  listAll(): NoteRow[];
  updateTitle(id: string, title: string, updatedAt: string): void;
  updateMarkdownExport(id: string, markdown: string, updatedAt: string): void;
  softDelete(id: string, trashedAt: string): void;
  restore(id: string): void;
  hardDelete(id: string): void;
  purgeOlderThan(cutoff: string): string[];
}

export function createNotesRepository(db: Database): NotesRepository {
  const insertStmt = db.prepare(
    `INSERT INTO notes
       (id, title, created_by, created_at, updated_at, trashed_at, markdown_export)
     VALUES (@id, @title, @created_by, @created_at, @updated_at, @trashed_at, @markdown_export)`,
  );
  const findByIdStmt = db.prepare<[string], NoteRow>(`SELECT * FROM notes WHERE id = ?`);
  const listLiveStmt = db.prepare<[], NoteRow>(
    `SELECT * FROM notes WHERE trashed_at IS NULL ORDER BY updated_at DESC`,
  );
  const listTrashedStmt = db.prepare<[], NoteRow>(
    `SELECT * FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC`,
  );
  const listAllStmt = db.prepare<[], NoteRow>(`SELECT * FROM notes ORDER BY created_at`);
  const updateTitleStmt = db.prepare(`UPDATE notes SET title = ?, updated_at = ? WHERE id = ?`);
  const updateMarkdownStmt = db.prepare(
    `UPDATE notes SET markdown_export = ?, updated_at = ? WHERE id = ?`,
  );
  const softDeleteStmt = db.prepare(`UPDATE notes SET trashed_at = ? WHERE id = ?`);
  const restoreStmt = db.prepare(`UPDATE notes SET trashed_at = NULL WHERE id = ?`);
  const hardDeleteStmt = db.prepare(`DELETE FROM notes WHERE id = ?`);
  const purgeListStmt = db.prepare<[string], { id: string }>(
    `SELECT id FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?`,
  );
  const purgeDeleteStmt = db.prepare(
    `DELETE FROM notes WHERE trashed_at IS NOT NULL AND trashed_at < ?`,
  );

  return {
    insert(note) {
      insertStmt.run(note);
      return note;
    },
    findById: (id) => findByIdStmt.get(id),
    listLive: () => listLiveStmt.all(),
    listTrashed: () => listTrashedStmt.all(),
    listAll: () => listAllStmt.all(),
    updateTitle: (id, title, updatedAt) => {
      updateTitleStmt.run(title, updatedAt, id);
    },
    updateMarkdownExport: (id, markdown, updatedAt) => {
      updateMarkdownStmt.run(markdown, updatedAt, id);
    },
    softDelete: (id, trashedAt) => {
      softDeleteStmt.run(trashedAt, id);
    },
    restore: (id) => {
      restoreStmt.run(id);
    },
    hardDelete: (id) => {
      hardDeleteStmt.run(id);
    },
    purgeOlderThan: (cutoff) => {
      const ids = purgeListStmt.all(cutoff).map((r) => r.id);
      purgeDeleteStmt.run(cutoff);
      return ids;
    },
  };
}

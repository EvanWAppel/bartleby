import type { Database } from 'better-sqlite3';
import type { SearchHit } from './types.js';

export interface SearchRepository {
  searchNotes(query: string, opts?: { limit?: number; offset?: number }): SearchHit[];
}

export function createSearchRepository(db: Database): SearchRepository {
  const stmt = db.prepare<[string, number, number], SearchHit>(
    `SELECT n.id        AS id,
            n.title     AS title,
            snippet(notes_fts, 1, '<mark>', '</mark>', '…', 16) AS snippet
     FROM notes_fts
     JOIN notes n ON n.rowid = notes_fts.rowid
     WHERE notes_fts MATCH ?
       AND n.trashed_at IS NULL
     ORDER BY bm25(notes_fts)
     LIMIT ? OFFSET ?`,
  );

  return {
    searchNotes(query, opts) {
      const limit = opts?.limit ?? 50;
      const offset = opts?.offset ?? 0;
      return stmt.all(query, limit, offset);
    },
  };
}

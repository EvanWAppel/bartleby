// notes: metadata-only (no yjs_state — Hocuspocus owns the `documents` table;
// bridge by notes.id = documents.name). See ../README.md.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE notes (
      id               TEXT PRIMARY KEY NOT NULL,
      title            TEXT NOT NULL,
      created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      trashed_at       TEXT,
      markdown_export  TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_notes_trashed_at ON notes(trashed_at);
    CREATE INDEX idx_notes_updated_at ON notes(updated_at);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS notes;`);
}

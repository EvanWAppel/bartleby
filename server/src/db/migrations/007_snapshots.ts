// snapshots: full Yjs state per snapshot. NULL label = auto-snapshot
// (subject to retention pruning in C-005); non-NULL = named & exempt.
// Composite index (note_id, created_at) for the per-note newest-first
// listing.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE snapshots (
      id          TEXT PRIMARY KEY NOT NULL,
      note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      yjs_state   BLOB NOT NULL,
      created_at  TEXT NOT NULL,
      label       TEXT
    );
    CREATE INDEX idx_snapshots_note_created ON snapshots(note_id, created_at);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS snapshots;`);
}

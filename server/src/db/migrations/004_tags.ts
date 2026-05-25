// tags: per-note tag strings. Re-derived from markdown_export on every Yjs
// change (S-009). Unique (note_id, tag) deduplicates within a note; tag
// index supports the sidebar "filter by tag" view.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE tags (
      note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag      TEXT NOT NULL,
      PRIMARY KEY (note_id, tag)
    );
    CREATE INDEX idx_tags_tag ON tags(tag);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS tags;`);
}

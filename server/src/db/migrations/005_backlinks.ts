// backlinks: outgoing [[Note Title]] references. Re-derived on every Yjs
// change (S-009). Both source and target index to support the inbound-pane
// view (lookup by target) and outbound-pane / debug view (lookup by source).

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE backlinks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      link_text       TEXT NOT NULL
    );
    CREATE INDEX idx_backlinks_source ON backlinks(source_note_id);
    CREATE INDEX idx_backlinks_target ON backlinks(target_note_id);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS backlinks;`);
}

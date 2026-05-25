// note_titles_history: every title a note has ever held, with a half-open
// validity interval [valid_from, valid_to). The current title has valid_to
// IS NULL. Used to resolve old [[Backlinks]] after rename (S-008).

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE note_titles_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      valid_from  TEXT NOT NULL,
      valid_to    TEXT
    );
    CREATE INDEX idx_note_titles_history_title   ON note_titles_history(title);
    CREATE INDEX idx_note_titles_history_note_id ON note_titles_history(note_id);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS note_titles_history;`);
}

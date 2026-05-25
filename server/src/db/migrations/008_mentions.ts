// mentions: one row per @ resolution. `source` is a free-text origin
// hint (e.g., "note:<uuid>" or "comment:<uuid>") so the mention extractor
// in M-001/M-002 can record where the mention came from without taking
// on a strict FK to two different tables.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE mentions (
      id                  TEXT PRIMARY KEY NOT NULL,
      note_id             TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      mentioned_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      mentioning_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source              TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      read_at             TEXT,
      email_sent_at       TEXT
    );
    CREATE INDEX idx_mentions_inbox ON mentions(mentioned_user_id, read_at);
    CREATE INDEX idx_mentions_email ON mentions(email_sent_at);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS mentions;`);
}

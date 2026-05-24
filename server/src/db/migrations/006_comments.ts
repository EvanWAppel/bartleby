// comments: threaded one level deep. `anchor` is a serialized Yjs
// RelativePosition (TEXT JSON); `original_quote` snapshots the anchored
// text at create time for orphan recovery (C-008/C-009). Resolving sets
// `resolved_at` rather than deleting.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE comments (
      id                 TEXT PRIMARY KEY NOT NULL,
      note_id            TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      author_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      parent_comment_id  TEXT          REFERENCES comments(id) ON DELETE CASCADE,
      anchor             TEXT NOT NULL,
      original_quote     TEXT NOT NULL,
      body               TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      resolved_at        TEXT
    );
    CREATE INDEX idx_comments_note_id ON comments(note_id);
    CREATE INDEX idx_comments_parent  ON comments(parent_comment_id);
  `);
}

export function down(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS comments;`);
}

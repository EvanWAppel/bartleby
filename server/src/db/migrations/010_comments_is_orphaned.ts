// C-008: add is_orphaned flag to comments.
//
// Denormalized boolean (stored as INTEGER 0/1) so list endpoints don't
// have to crack open the Yjs doc on every read. The S-009 onStoreDocument
// hook recomputes it for every comment on the note after each persistence
// pass — see server/src/derived/hook.ts.
//
// Defaults to 0 (not orphaned) so existing rows and freshly-created
// comments before their first recompute are treated as anchored. The
// truth-of-record is what the hook last wrote.

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE comments
      ADD COLUMN is_orphaned INTEGER NOT NULL DEFAULT 0;
  `);
}

export function down(db: Database): void {
  // SQLite added ALTER TABLE … DROP COLUMN in 3.35; better-sqlite3 ships
  // a recent enough engine. Down migrations exist for symmetry; in
  // practice we only roll forward.
  db.exec(`ALTER TABLE comments DROP COLUMN is_orphaned;`);
}

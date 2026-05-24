// notes_fts: external-content FTS5 over notes(title, markdown_export).
// `content='notes'` and `content_rowid='rowid'` make FTS reuse the implicit
// integer rowid SQLite assigns to each notes row (we can't FTS-index a
// TEXT primary key directly). Queries join back on rowid to recover id.
//
// The three triggers keep the index in sync: insert/delete are direct,
// update is a delete+insert (FTS5 doesn't support partial updates of
// external-content rows).

import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      title,
      markdown_export,
      content='notes',
      content_rowid='rowid'
    );

    CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts (rowid, title, markdown_export)
      VALUES (new.rowid, new.title, new.markdown_export);
    END;

    CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts (notes_fts, rowid, title, markdown_export)
      VALUES ('delete', old.rowid, old.title, old.markdown_export);
    END;

    CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts (notes_fts, rowid, title, markdown_export)
      VALUES ('delete', old.rowid, old.title, old.markdown_export);
      INSERT INTO notes_fts (rowid, title, markdown_export)
      VALUES (new.rowid, new.title, new.markdown_export);
    END;
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS notes_fts_au;
    DROP TRIGGER IF EXISTS notes_fts_ad;
    DROP TRIGGER IF EXISTS notes_fts_ai;
    DROP TABLE IF EXISTS notes_fts;
  `);
}

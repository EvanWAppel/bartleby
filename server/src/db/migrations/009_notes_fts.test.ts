// D-010: notes_fts — external-content FTS5 over notes(title, markdown_export).
// Triggers on insert/update/delete of notes keep the index in sync.
//
// Queries resolve back to notes by joining on the implicit integer rowid
// (FTS5 requires INTEGER rowid; our notes.id is TEXT, so we use external
// content with `content='notes'` and join on rowid).

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

function seedUser(db: import('better-sqlite3').Database): void {
  db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');
}

function insertNote(
  db: import('better-sqlite3').Database,
  id: string,
  title: string,
  markdown: string,
): void {
  db.prepare(
    `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, title, 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', markdown);
}

function searchIds(db: import('better-sqlite3').Database, query: string): string[] {
  const rows = db
    .prepare(
      `SELECT n.id FROM notes n
       JOIN notes_fts ON notes_fts.rowid = n.rowid
       WHERE notes_fts MATCH ?
       ORDER BY n.id`,
    )
    .all(query) as { id: string }[];
  return rows.map((r) => r.id);
}

describe('migration 009 notes_fts (D-010)', () => {
  test('notes_fts is registered as a virtual table', ({ db }) => {
    const row = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE name = 'notes_fts' AND type = 'table'`)
      .get() as { name: string; sql: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.sql.toLowerCase()).toContain('virtual table');
    expect(row!.sql.toLowerCase()).toContain('fts5');
  });

  test('three triggers exist on notes (insert, update, delete)', ({ db }) => {
    const triggers = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'notes' ORDER BY name`,
      )
      .all() as { name: string }[];

    const names = triggers.map((t) => t.name);
    expect(names).toContain('notes_fts_ai');
    expect(names).toContain('notes_fts_ad');
    expect(names).toContain('notes_fts_au');
  });

  test('insert: a new note is findable by title and body', ({ db }) => {
    seedUser(db);
    insertNote(db, 'n1', 'Trip to Spain', 'Madrid food list and tapas notes.');

    expect(searchIds(db, 'Spain')).toEqual(['n1']);
    expect(searchIds(db, 'tapas')).toEqual(['n1']);
    expect(searchIds(db, 'Madrid')).toEqual(['n1']);
  });

  test('update title: FTS reflects the new title, old title no longer matches', ({ db }) => {
    seedUser(db);
    insertNote(db, 'n1', 'Trip to Spain', 'body');

    db.prepare(`UPDATE notes SET title = ? WHERE id = ?`).run('Trip to Iberia', 'n1');

    expect(searchIds(db, 'Iberia')).toEqual(['n1']);
    expect(searchIds(db, 'Spain')).toEqual([]);
  });

  test('update markdown_export: FTS reflects the new content', ({ db }) => {
    seedUser(db);
    insertNote(db, 'n1', 'My note', 'original keyword aardvark');

    db.prepare(`UPDATE notes SET markdown_export = ? WHERE id = ?`).run(
      'replacement keyword pangolin',
      'n1',
    );

    expect(searchIds(db, 'aardvark')).toEqual([]);
    expect(searchIds(db, 'pangolin')).toEqual(['n1']);
  });

  test('delete: the note is removed from the FTS index', ({ db }) => {
    seedUser(db);
    insertNote(db, 'n1', 'goodbye', 'body');

    db.prepare(`DELETE FROM notes WHERE id = ?`).run('n1');

    expect(searchIds(db, 'goodbye')).toEqual([]);
    expect(searchIds(db, 'body')).toEqual([]);
  });

  test('multiple notes: query returns only matching ones', ({ db }) => {
    seedUser(db);
    insertNote(db, 'n1', 'Spain', 'paella');
    insertNote(db, 'n2', 'Japan', 'sushi');
    insertNote(db, 'n3', 'Italy', 'paella also has italian relatives');

    expect(searchIds(db, 'paella')).toEqual(['n1', 'n3']);
    expect(searchIds(db, 'sushi')).toEqual(['n2']);
  });
});

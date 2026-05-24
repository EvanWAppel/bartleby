// D-005: tags table — many-to-many between notes and tag strings, with
// per-note dedup and a tag→notes lookup.

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
}

interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

interface IndexInfo {
  name: string;
  unique: number;
}

function seedUserAndNotes(db: import('better-sqlite3').Database): void {
  db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

  const insertNote = db.prepare(
    `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertNote.run('n1', 'A', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
  insertNote.run('n2', 'B', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
}

describe('migration 004 tags (D-005)', () => {
  test('schema: expected columns', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(tags)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(['note_id', 'tag']);
    expect(byName.get('note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('tag')).toMatchObject({ type: 'TEXT', notnull: 1 });
  });

  test('foreign key: note_id → notes(id), ON DELETE CASCADE', ({ db }) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(tags)`).all() as ForeignKeyInfo[];
    const noteFk = fks.find((f) => f.from === 'note_id');
    expect(noteFk).toMatchObject({ table: 'notes', to: 'id', on_delete: 'CASCADE' });
  });

  test('unique (note_id, tag) — same tag cannot be added twice to a note', ({ db }) => {
    seedUserAndNotes(db);
    const insertTag = db.prepare(`INSERT INTO tags (note_id, tag) VALUES (?, ?)`);
    insertTag.run('n1', 'travel');
    expect(() => insertTag.run('n1', 'travel')).toThrow(/UNIQUE/);
  });

  test('list-by-tag returns notes that carry the tag', ({ db }) => {
    seedUserAndNotes(db);
    const insertTag = db.prepare(`INSERT INTO tags (note_id, tag) VALUES (?, ?)`);
    insertTag.run('n1', 'travel');
    insertTag.run('n2', 'travel');
    insertTag.run('n1', 'reading');

    const travelNotes = db
      .prepare(`SELECT note_id FROM tags WHERE tag = ? ORDER BY note_id`)
      .all('travel') as { note_id: string }[];
    expect(travelNotes.map((r) => r.note_id)).toEqual(['n1', 'n2']);

    const readingNotes = db
      .prepare(`SELECT note_id FROM tags WHERE tag = ? ORDER BY note_id`)
      .all('reading') as { note_id: string }[];
    expect(readingNotes.map((r) => r.note_id)).toEqual(['n1']);
  });

  test('index on tag exists (for tag→notes lookup)', ({ db }) => {
    const indexes = db.prepare(`PRAGMA index_list(tags)`).all() as IndexInfo[];
    const indexedCols = indexes.map((i) => {
      const cols = db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[];
      return cols.map((c) => c.name).join(',');
    });
    expect(indexedCols).toContain('tag');
  });

  test('cascade: deleting a note removes its tag rows', ({ db }) => {
    seedUserAndNotes(db);
    db.prepare(`INSERT INTO tags (note_id, tag) VALUES (?, ?)`).run('n1', 'travel');
    db.prepare(`DELETE FROM notes WHERE id = ?`).run('n1');

    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM tags WHERE note_id = ?`).get('n1') as {
      n: number;
    };
    expect(remaining.n).toBe(0);
  });
});

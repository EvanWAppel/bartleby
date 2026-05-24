// D-004: note_titles_history — track every title a note has held, so that
// old `[[backlinks]]` keep resolving after rename.

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
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

describe('migration 003 note_titles_history (D-004)', () => {
  test('schema: expected columns', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(note_titles_history)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(['id', 'note_id', 'title', 'valid_from', 'valid_to']);

    expect(byName.get('id')).toMatchObject({ type: 'INTEGER', pk: 1 });
    expect(byName.get('note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('title')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('valid_from')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('valid_to')).toMatchObject({ type: 'TEXT', notnull: 0 });
  });

  test('foreign key to notes with ON DELETE CASCADE', ({ db }) => {
    const fks = db
      .prepare(`PRAGMA foreign_key_list(note_titles_history)`)
      .all() as ForeignKeyInfo[];
    const noteFk = fks.find((f) => f.from === 'note_id');
    expect(noteFk).toMatchObject({
      table: 'notes',
      to: 'id',
      on_delete: 'CASCADE',
    });
  });

  test('indexes on (title) and (note_id)', ({ db }) => {
    const indexes = db.prepare(`PRAGMA index_list(note_titles_history)`).all() as IndexInfo[];
    const indexedCols = indexes.map((i) => {
      const cols = db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[];
      return cols.map((c) => c.name).join(',');
    });
    expect(indexedCols).toContain('title');
    expect(indexedCols).toContain('note_id');
  });

  test('two titles for one note — resolving the old title returns the right note', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    db.prepare(
      `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('n1', 'Trip to Spain', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:01:00.000Z', '');

    const insertTitle = db.prepare(
      `INSERT INTO note_titles_history (note_id, title, valid_from, valid_to)
       VALUES (?, ?, ?, ?)`,
    );
    insertTitle.run('n1', 'Trip to Spain', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:30.000Z');
    insertTitle.run('n1', 'Trip to Iberia', '2026-05-23T00:00:30.000Z', null);

    const resolveOld = db
      .prepare(`SELECT note_id FROM note_titles_history WHERE title = ? ORDER BY valid_from DESC`)
      .all('Trip to Spain') as { note_id: string }[];
    expect(resolveOld).toEqual([{ note_id: 'n1' }]);

    const current = db
      .prepare(`SELECT title FROM note_titles_history WHERE note_id = ? AND valid_to IS NULL`)
      .all('n1') as { title: string }[];
    expect(current).toEqual([{ title: 'Trip to Iberia' }]);
  });

  test('cascade: deleting a note removes its title history', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    db.prepare(
      `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('n1', 't', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');

    db.prepare(
      `INSERT INTO note_titles_history (note_id, title, valid_from, valid_to)
       VALUES (?, ?, ?, ?)`,
    ).run('n1', 't', '2026-05-23T00:00:00.000Z', null);

    db.prepare(`DELETE FROM notes WHERE id = ?`).run('n1');

    const remaining = db
      .prepare(`SELECT COUNT(*) AS n FROM note_titles_history WHERE note_id = ?`)
      .get('n1') as { n: number };
    expect(remaining.n).toBe(0);
  });
});

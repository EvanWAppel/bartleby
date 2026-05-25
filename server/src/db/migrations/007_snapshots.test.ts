// D-008: snapshots — full Yjs state dumps per note. `label` is nullable
// (NULL = auto-snapshot, non-NULL = named). Listed newest-first per note.

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
}

function seed(db: import('better-sqlite3').Database): void {
  db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

  db.prepare(
    `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('n1', 'A', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
}

describe('migration 007 snapshots (D-008)', () => {
  test('schema: expected columns', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(snapshots)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual([
      'created_at',
      'id',
      'label',
      'note_id',
      'yjs_state',
    ]);

    expect(byName.get('id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('yjs_state')).toMatchObject({ type: 'BLOB', notnull: 1 });
    expect(byName.get('created_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('label')).toMatchObject({ type: 'TEXT', notnull: 0 });
  });

  test('FK: note_id → notes(id), ON DELETE CASCADE', ({ db }) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(snapshots)`).all() as ForeignKeyInfo[];
    const fk = fks.find((f) => f.from === 'note_id');
    expect(fk).toMatchObject({ table: 'notes', to: 'id', on_delete: 'CASCADE' });
  });

  test('composite index on (note_id, created_at) for per-note listing', ({ db }) => {
    const indexes = db.prepare(`PRAGMA index_list(snapshots)`).all() as IndexInfo[];
    const compositeIndexes = indexes
      .map((i) => {
        const cols = db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[];
        return cols.map((c) => c.name).join(',');
      })
      .filter((cols) => cols.startsWith('note_id'));
    expect(compositeIndexes).toContain('note_id,created_at');
  });

  test('list-by-note newest-first via composite index', ({ db }) => {
    seed(db);
    const insert = db.prepare(
      `INSERT INTO snapshots (id, note_id, yjs_state, created_at, label) VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('s1', 'n1', Buffer.from([1, 2, 3]), '2026-05-23T00:00:00.000Z', null);
    insert.run('s2', 'n1', Buffer.from([4, 5, 6]), '2026-05-23T00:05:00.000Z', 'named');
    insert.run('s3', 'n1', Buffer.from([7, 8, 9]), '2026-05-23T00:10:00.000Z', null);

    const rows = db
      .prepare(`SELECT id, label FROM snapshots WHERE note_id = ? ORDER BY created_at DESC`)
      .all('n1') as { id: string; label: string | null }[];

    expect(rows).toEqual([
      { id: 's3', label: null },
      { id: 's2', label: 'named' },
      { id: 's1', label: null },
    ]);
  });

  test('yjs_state preserves binary content', ({ db }) => {
    seed(db);
    const original = Buffer.from([0, 1, 2, 255, 128, 64]);
    db.prepare(
      `INSERT INTO snapshots (id, note_id, yjs_state, created_at, label) VALUES (?, ?, ?, ?, ?)`,
    ).run('s1', 'n1', original, '2026-05-23T00:00:00.000Z', null);

    const row = db.prepare(`SELECT yjs_state FROM snapshots WHERE id = ?`).get('s1') as {
      yjs_state: Buffer;
    };
    expect(Buffer.compare(row.yjs_state, original)).toBe(0);
  });

  test('CASCADE: deleting the note deletes its snapshots', ({ db }) => {
    seed(db);
    db.prepare(
      `INSERT INTO snapshots (id, note_id, yjs_state, created_at, label) VALUES (?, ?, ?, ?, ?)`,
    ).run('s1', 'n1', Buffer.from([1]), '2026-05-23T00:00:00.000Z', null);

    db.prepare(`DELETE FROM notes WHERE id = ?`).run('n1');
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM snapshots`).get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});

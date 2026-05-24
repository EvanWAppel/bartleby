// D-003: notes table — metadata only (Yjs blob lives in Hocuspocus's
// `documents` table; see server/src/db/README.md). Columns, FK to users,
// trashed_at filter behaviour.

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: string | null;
}

interface ForeignKeyInfo {
  table: string;
  from: string;
  to: string;
  on_delete: string;
  on_update: string;
}

describe('migration 002 notes (D-003)', () => {
  test('schema: expected column set, no yjs_state column', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(notes)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual([
      'created_at',
      'created_by',
      'id',
      'markdown_export',
      'title',
      'trashed_at',
      'updated_at',
    ]);

    expect(byName.has('yjs_state')).toBe(false);

    expect(byName.get('id')).toMatchObject({ type: 'TEXT', notnull: 1, pk: 1 });
    expect(byName.get('title')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('created_by')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('created_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('updated_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('trashed_at')).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(byName.get('markdown_export')).toMatchObject({ type: 'TEXT', notnull: 1 });
  });

  test('foreign key: created_by → users(id), ON DELETE RESTRICT', ({ db }) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(notes)`).all() as ForeignKeyInfo[];
    const userFk = fks.find((f) => f.from === 'created_by');
    expect(userFk).toMatchObject({
      table: 'users',
      to: 'id',
      on_delete: 'RESTRICT',
    });
  });

  test('round-trips an insert + select', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    db.prepare(
      `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'n1',
      'Trip to Spain',
      'u1',
      '2026-05-23T00:01:00.000Z',
      '2026-05-23T00:01:00.000Z',
      '# Trip to Spain\n',
    );

    const row = db.prepare(`SELECT * FROM notes WHERE id = ?`).get('n1');
    expect(row).toEqual({
      id: 'n1',
      title: 'Trip to Spain',
      created_by: 'u1',
      created_at: '2026-05-23T00:01:00.000Z',
      updated_at: '2026-05-23T00:01:00.000Z',
      trashed_at: null,
      markdown_export: '# Trip to Spain\n',
    });
  });

  test('trashed_at filter separates live from trashed notes', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    const insertNote = db.prepare(
      `INSERT INTO notes (id, title, created_by, created_at, updated_at, trashed_at, markdown_export)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertNote.run(
      'n-live',
      'live',
      'u1',
      '2026-05-23T00:00:00.000Z',
      '2026-05-23T00:00:00.000Z',
      null,
      '',
    );
    insertNote.run(
      'n-trash',
      'trash',
      'u1',
      '2026-05-23T00:00:00.000Z',
      '2026-05-23T00:00:00.000Z',
      '2026-05-23T00:00:10.000Z',
      '',
    );

    const live = db.prepare(`SELECT id FROM notes WHERE trashed_at IS NULL ORDER BY id`).all() as {
      id: string;
    }[];
    const trashed = db
      .prepare(`SELECT id FROM notes WHERE trashed_at IS NOT NULL ORDER BY id`)
      .all() as { id: string }[];

    expect(live.map((r) => r.id)).toEqual(['n-live']);
    expect(trashed.map((r) => r.id)).toEqual(['n-trash']);
  });

  test('FK enforcement: cannot insert note for unknown user', ({ db }) => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('n1', 't', 'no-such-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ''),
    ).toThrow(/FOREIGN KEY/);
  });
});

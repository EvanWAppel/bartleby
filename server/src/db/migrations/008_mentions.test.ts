// D-009: mentions — one row per @ in a note body or comment. Filtered by
// unread (read_at IS NULL) for the inbox view, with email_sent_at to
// track batched-notification delivery (M-005).

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

function seed(db: import('better-sqlite3').Database): void {
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  insertUser.run('u-alice', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');
  insertUser.run('u-bob', 'bob@example.com', 'bob', '#00ff00', '2026-05-23T00:00:00.000Z');

  db.prepare(
    `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('n1', 'A', 'u-alice', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
}

describe('migration 008 mentions (D-009)', () => {
  test('schema: expected columns', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(mentions)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual([
      'created_at',
      'email_sent_at',
      'id',
      'mentioned_user_id',
      'mentioning_user_id',
      'note_id',
      'read_at',
      'source',
    ]);

    expect(byName.get('id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('mentioned_user_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('mentioning_user_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('source')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('created_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('read_at')).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(byName.get('email_sent_at')).toMatchObject({ type: 'TEXT', notnull: 0 });
  });

  test('FKs: note CASCADE, mentioned/mentioning users RESTRICT', ({ db }) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(mentions)`).all() as ForeignKeyInfo[];
    expect(fks.find((f) => f.from === 'note_id')).toMatchObject({
      table: 'notes',
      to: 'id',
      on_delete: 'CASCADE',
    });
    expect(fks.find((f) => f.from === 'mentioned_user_id')).toMatchObject({
      table: 'users',
      to: 'id',
      on_delete: 'RESTRICT',
    });
    expect(fks.find((f) => f.from === 'mentioning_user_id')).toMatchObject({
      table: 'users',
      to: 'id',
      on_delete: 'RESTRICT',
    });
  });

  test('unread filter returns only mentions with read_at IS NULL', ({ db }) => {
    seed(db);
    const insert = db.prepare(
      `INSERT INTO mentions
         (id, note_id, mentioned_user_id, mentioning_user_id, source, created_at, read_at, email_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('m1', 'n1', 'u-bob', 'u-alice', 'note:n1', '2026-05-23T00:00:00.000Z', null, null);
    insert.run(
      'm2',
      'n1',
      'u-bob',
      'u-alice',
      'note:n1',
      '2026-05-23T00:01:00.000Z',
      '2026-05-23T00:02:00.000Z',
      null,
    );
    insert.run('m3', 'n1', 'u-bob', 'u-alice', 'note:n1', '2026-05-23T00:02:00.000Z', null, null);

    const unread = db
      .prepare(
        `SELECT id FROM mentions WHERE mentioned_user_id = ? AND read_at IS NULL ORDER BY id`,
      )
      .all('u-bob') as { id: string }[];

    expect(unread.map((r) => r.id)).toEqual(['m1', 'm3']);
  });

  test('CASCADE: deleting the note deletes its mentions', ({ db }) => {
    seed(db);
    db.prepare(
      `INSERT INTO mentions
         (id, note_id, mentioned_user_id, mentioning_user_id, source, created_at, read_at, email_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('m1', 'n1', 'u-bob', 'u-alice', 'note:n1', '2026-05-23T00:00:00.000Z', null, null);

    db.prepare(`DELETE FROM notes WHERE id = ?`).run('n1');
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM mentions`).get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  test('index on (mentioned_user_id, read_at) supports the inbox query', ({ db }) => {
    const indexes = db.prepare(`PRAGMA index_list(mentions)`).all() as { name: string }[];
    const indexedCols = indexes.map((i) => {
      const cols = db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[];
      return cols.map((c) => c.name).join(',');
    });
    // Either a composite (mentioned_user_id, read_at) or a leading-column
    // index on mentioned_user_id is acceptable; assert at least one starts
    // with mentioned_user_id.
    expect(indexedCols.some((c) => c.startsWith('mentioned_user_id'))).toBe(true);
  });
});

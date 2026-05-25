// D-007: comments — threaded one level deep (parent_comment_id), anchored
// to a serialized Yjs RelativePosition (TEXT), with original_quote snapshot
// for orphan recovery and a resolved_at timestamp (nullable).

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
  db.prepare(
    `INSERT INTO users (id, email, display_name, color, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

  db.prepare(
    `INSERT INTO notes (id, title, created_by, created_at, updated_at, markdown_export)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('n1', 'A', 'u1', '2026-05-23T00:00:00.000Z', '2026-05-23T00:00:00.000Z', '');
}

describe('migration 006 comments (D-007)', () => {
  test('schema: expected columns', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(comments)`).all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual([
      'anchor',
      'author_id',
      'body',
      'created_at',
      'id',
      'note_id',
      'original_quote',
      'parent_comment_id',
      'resolved_at',
    ]);

    expect(byName.get('id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('note_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('author_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('parent_comment_id')).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(byName.get('anchor')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('original_quote')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('body')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('created_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('resolved_at')).toMatchObject({ type: 'TEXT', notnull: 0 });
  });

  test('FKs: note→CASCADE, author→RESTRICT, parent→CASCADE', ({ db }) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(comments)`).all() as ForeignKeyInfo[];
    const note = fks.find((f) => f.from === 'note_id');
    const author = fks.find((f) => f.from === 'author_id');
    const parent = fks.find((f) => f.from === 'parent_comment_id');

    expect(note).toMatchObject({ table: 'notes', to: 'id', on_delete: 'CASCADE' });
    expect(author).toMatchObject({ table: 'users', to: 'id', on_delete: 'RESTRICT' });
    expect(parent).toMatchObject({ table: 'comments', to: 'id', on_delete: 'CASCADE' });
  });

  test('insert a thread (top-level + reply) and resolve the top', ({ db }) => {
    seed(db);

    const insert = db.prepare(
      `INSERT INTO comments
         (id, note_id, author_id, parent_comment_id, anchor, original_quote, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'c1',
      'n1',
      'u1',
      null,
      '{"a":1}',
      'the quoted span',
      'first',
      '2026-05-23T00:00:00.000Z',
    );
    insert.run(
      'c2',
      'n1',
      'u1',
      'c1',
      '{"a":1}',
      'the quoted span',
      'reply',
      '2026-05-23T00:00:30.000Z',
    );

    const replies = db
      .prepare(`SELECT id FROM comments WHERE parent_comment_id = ? ORDER BY id`)
      .all('c1') as { id: string }[];
    expect(replies.map((r) => r.id)).toEqual(['c2']);

    db.prepare(`UPDATE comments SET resolved_at = ? WHERE id = ?`).run(
      '2026-05-23T00:01:00.000Z',
      'c1',
    );

    const c1 = db.prepare(`SELECT resolved_at FROM comments WHERE id = ?`).get('c1') as {
      resolved_at: string | null;
    };
    expect(c1.resolved_at).toBe('2026-05-23T00:01:00.000Z');

    // Reply is independent.
    const c2 = db.prepare(`SELECT resolved_at FROM comments WHERE id = ?`).get('c2') as {
      resolved_at: string | null;
    };
    expect(c2.resolved_at).toBeNull();
  });

  test('parent CASCADE: deleting the parent deletes replies', ({ db }) => {
    seed(db);
    const insert = db.prepare(
      `INSERT INTO comments
         (id, note_id, author_id, parent_comment_id, anchor, original_quote, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('c1', 'n1', 'u1', null, '{}', 'q', 'first', '2026-05-23T00:00:00.000Z');
    insert.run('c2', 'n1', 'u1', 'c1', '{}', 'q', 'reply', '2026-05-23T00:00:30.000Z');

    db.prepare(`DELETE FROM comments WHERE id = ?`).run('c1');

    const remaining = db.prepare(`SELECT id FROM comments`).all() as { id: string }[];
    expect(remaining).toEqual([]);
  });

  test('note CASCADE: deleting the note deletes the thread', ({ db }) => {
    seed(db);
    db.prepare(
      `INSERT INTO comments
         (id, note_id, author_id, parent_comment_id, anchor, original_quote, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('c1', 'n1', 'u1', null, '{}', 'q', 'first', '2026-05-23T00:00:00.000Z');

    db.prepare(`DELETE FROM notes WHERE id = ?`).run('n1');
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM comments`).get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});

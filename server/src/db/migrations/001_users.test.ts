// D-002: users table — column set, types, unique-email constraint.

import { describe, expect } from 'vitest';
import { test } from '../test-fixture.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

describe('migration 001 users (D-002)', () => {
  test('schema: expected columns and types', ({ db }) => {
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as ColumnInfo[];

    const byName = new Map(cols.map((c) => [c.name, c]));
    expect([...byName.keys()].sort()).toEqual([
      'color',
      'created_at',
      'display_name',
      'email',
      'id',
    ]);

    expect(byName.get('id')).toMatchObject({ type: 'TEXT', notnull: 1, pk: 1 });
    expect(byName.get('email')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('display_name')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('color')).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.get('created_at')).toMatchObject({ type: 'TEXT', notnull: 1 });
  });

  test('email has a unique index', ({ db }) => {
    const indexes = db.prepare(`PRAGMA index_list(users)`).all() as {
      name: string;
      unique: number;
    }[];

    const emailIndex = indexes.find((i) => i.unique === 1);
    expect(emailIndex).toBeDefined();

    const cols = db.prepare(`PRAGMA index_info(${emailIndex!.name})`).all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toEqual(['email']);
  });

  test('round-trips an insert + select', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get('u1');
    expect(row).toEqual({
      id: 'u1',
      email: 'alice@example.com',
      display_name: 'alice',
      color: '#ff0000',
      created_at: '2026-05-23T00:00:00.000Z',
    });
  });

  test('rejects duplicate emails', ({ db }) => {
    const stmt = db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    stmt.run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    expect(() =>
      stmt.run('u2', 'alice@example.com', 'alice2', '#00ff00', '2026-05-23T00:00:01.000Z'),
    ).toThrow(/UNIQUE/);
  });
});

// D-012: shared test-fixture utilities for migrated in-memory SQLite.

import { describe, expect } from 'vitest';
import { test, createTestDatabase } from './test-fixture.js';

describe('test-fixture (D-012)', () => {
  test('test 1 — inserts a user, sees count 1', ({ db }) => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, color, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

    const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    expect(row.n).toBe(1);
  });

  test('test 2 — runs against a fresh db, sees count 0', ({ db }) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    expect(row.n).toBe(0);
  });

  test('createTestDatabase returns mutually-isolated instances', async () => {
    const a = await createTestDatabase();
    const b = await createTestDatabase();
    try {
      a.prepare(
        `INSERT INTO users (id, email, display_name, color, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('u1', 'alice@example.com', 'alice', '#ff0000', '2026-05-23T00:00:00.000Z');

      const bCount = b.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
      expect(bCount.n).toBe(0);
    } finally {
      a.close();
      b.close();
    }
  });
});

// In-memory SQLite + all migrations applied, per test. Closes on teardown.

import BetterSqlite3, { type Database } from 'better-sqlite3';
import { test as base } from 'vitest';
import { createMigrator } from './migrator.js';

export async function createTestDatabase(): Promise<Database> {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  await createMigrator(db).up();
  return db;
}

interface DbFixture {
  db: Database;
}

export const test = base.extend<DbFixture>({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = await createTestDatabase();
    await use(db);
    db.close();
  },
});

// D-001: migration tool round-trip semantics.
//
// Asserts that:
//   1. `up` followed by `down to: 0` leaves the schema empty (only the
//      umzug bookkeeping table remains).
//   2. `up` is idempotent — calling it twice produces the same schema.
//   3. up → down → up returns to the same schema as a single fresh `up`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import { createMigrator, MIGRATIONS_TABLE } from './migrator.js';

describe('migrator (D-001)', () => {
  let db: Database;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('after up + down, only the bookkeeping table remains', async () => {
    const migrator = createMigrator(db);
    await migrator.up();
    await migrator.down({ to: 0 });

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([MIGRATIONS_TABLE]);
  });

  it('up is idempotent', async () => {
    const migrator = createMigrator(db);
    await migrator.up();
    const first = schemaSnapshot(db);
    await migrator.up();
    const second = schemaSnapshot(db);
    expect(second).toEqual(first);
  });

  it('up → down → up matches a single fresh up', async () => {
    const m = createMigrator(db);
    await m.up();
    const fresh = schemaSnapshot(db);

    await m.down({ to: 0 });
    await m.up();
    const cycled = schemaSnapshot(db);

    expect(cycled).toEqual(fresh);
  });
});

function schemaSnapshot(db: Database): string[] {
  return (
    db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type IN ('table','index','trigger','view')
           AND name NOT LIKE 'sqlite_%'
           AND name != ?
         ORDER BY type, name`,
      )
      .all(MIGRATIONS_TABLE) as { sql: string | null }[]
  ).map((r) => r.sql ?? '');
}

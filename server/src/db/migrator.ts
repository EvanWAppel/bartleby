// Migration runner: umzug + better-sqlite3.
//
// Each migration is a file `migrations/NNN_description.ts` exporting `up(db)`
// and `down(db)`. The runner records applied migrations in `_migrations`.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { Umzug, type UmzugStorage } from 'umzug';

export const MIGRATIONS_TABLE = '_migrations';

export interface Migration {
  up(db: Database): void | Promise<void>;
  down(db: Database): void | Promise<void>;
}

interface MigrationContext {
  db: Database;
}

class SqliteStorage implements UmzugStorage<MigrationContext> {
  constructor(private readonly db: Database) {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
         name TEXT PRIMARY KEY NOT NULL,
         executed_at TEXT NOT NULL
       )`,
    );
  }

  logMigration({ name }: { name: string }): Promise<void> {
    this.db
      .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name, executed_at) VALUES (?, ?)`)
      .run(name, new Date().toISOString());
    return Promise.resolve();
  }

  unlogMigration({ name }: { name: string }): Promise<void> {
    this.db.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`).run(name);
    return Promise.resolve();
  }

  executed(): Promise<string[]> {
    const rows = this.db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`).all() as {
      name: string;
    }[];
    return Promise.resolve(rows.map((r) => r.name));
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function createMigrator(db: Database): Umzug<MigrationContext> {
  return new Umzug<MigrationContext>({
    context: { db },
    storage: new SqliteStorage(db),
    migrations: {
      glob: [`*${ext}`, { cwd: MIGRATIONS_DIR, ignore: ['*.test.*', '*.d.ts'] }],
      resolve: ({ name, path, context }) => {
        if (!path) {
          throw new Error(`migration ${name} has no file path`);
        }
        const filePath = path;
        return {
          name,
          up: async () => {
            const mod = (await import(filePath)) as Migration;
            await mod.up(context.db);
          },
          down: async () => {
            const mod = (await import(filePath)) as Migration;
            await mod.down(context.db);
          },
        };
      },
    },
    logger: undefined,
  });
}

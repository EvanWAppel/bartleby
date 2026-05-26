// Migration entrypoint — runs at startup before the Hocuspocus + HTTP
// servers boot. Idempotent: running twice is a no-op.
//
// Takes an already-open better-sqlite3 handle so the runtime can use
// the same connection downstream. This matters for `:memory:` paths
// (every connection to `:memory:` is a fresh database, so opening two
// would mean migrations apply to a db nobody else can see).

import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import { createMigrator } from './db/migrator.js';

export interface MigrateOptions {
  db: Database;
  logger: Logger;
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  const migrator = createMigrator(options.db);
  const applied = await migrator.up();
  options.logger.info(
    { applied: applied.map((m) => m.name) },
    applied.length === 0 ? 'migrate: schema already up to date' : 'migrate: applied',
  );
}

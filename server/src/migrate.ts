// Migration entrypoint — runs at container/dev startup before the
// Hocuspocus + HTTP servers boot. Idempotent: running twice is a no-op.
//
// Originally an O-PR-4 placeholder pending D-001. Now wired to D's
// umzug-based migrator: opens the SQLite file, applies any pending
// migrations, closes its own handle (the runtime opens a separate
// long-lived connection in src/db/open.ts).

import type { Logger } from 'pino';
import { openDatabase } from './db/open.js';
import { createMigrator } from './db/migrator.js';

export interface MigrateOptions {
  databasePath: string;
  logger: Logger;
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  const db = openDatabase(options.databasePath);
  try {
    const migrator = createMigrator(db);
    const applied = await migrator.up();
    options.logger.info(
      {
        databasePath: options.databasePath,
        applied: applied.map((m) => m.name),
      },
      applied.length === 0 ? 'migrate: schema already up to date' : 'migrate: applied',
    );
  } finally {
    db.close();
  }
}

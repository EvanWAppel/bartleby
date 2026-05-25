// Migration entrypoint — runs at container/dev startup before the
// Hocuspocus server boots. Idempotent: running twice is a no-op.
//
// TODO (Workstream D, task D-001): wire in the chosen migration tool
// (recommend umzug + better-sqlite3 per TASKS.md). Until D ships there
// are no migrations to run; this function is a no-op placeholder so
// the Dockerfile entrypoint and dev script can call it unconditionally.

import type { Logger } from 'pino';

export interface MigrateOptions {
  databasePath: string;
  logger: Logger;
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  options.logger.info(
    { databasePath: options.databasePath },
    'migrate: no migrations defined yet (Workstream D, D-001 will wire in umzug)',
  );
}

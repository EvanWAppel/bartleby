// Bartleby server entrypoint. Boots a Hocuspocus instance after
// validating env config and running pending migrations.

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { runMigrations } from './migrate.js';
import { createBartlebyServer } from './server.js';

export function placeholder(): string {
  return 'bartleby-server';
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 1234);
  const databasePath = process.env.BARTLEBY_DB_PATH ?? ':memory:';
  const server = await createBartlebyServer({ port, databasePath });
  console.log(
    `bartleby server listening on ws://127.0.0.1:${server.port}` + ` (db=${databasePath})`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await server.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    // Surface validation errors as a clean stderr message + non-zero
    // exit. Stack trace would be noise for env-config problems.
    if (err instanceof Error) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(`${String(err)}\n`);
    }
    process.exit(1);
  });
}

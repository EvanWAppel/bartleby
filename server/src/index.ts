// Bartleby server entrypoint. Boots a Hocuspocus instance after
// validating env config and running pending migrations.

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { runMigrations } from './migrate.js';
import { createBartlebyServer } from './server.js';
import { createBartlebyHttpServer } from './http.js';

export function placeholder(): string {
  return 'bartleby-server';
}

async function main(): Promise<void> {
  // 1. Validate env. Throws + exits if a required var is missing or
  //    a value violates its schema.
  const config = loadConfig();

  // 2. Structured logger from validated config.
  const logger = createLogger(config.LOG_LEVEL);

  logger.info(
    {
      port: config.PORT,
      bind: config.BARTLEBY_BIND_ADDRESS,
      databasePath: config.BARTLEBY_DB_PATH,
    },
    'starting bartleby server',
  );

  // 3. Run migrations idempotently (no-op until Workstream D ships).
  await runMigrations({ databasePath: config.BARTLEBY_DB_PATH, logger });

  // 4. Boot the Hocuspocus server.
  const server = await createBartlebyServer({
    port: config.PORT,
    databasePath: config.BARTLEBY_DB_PATH,
    address: config.BARTLEBY_BIND_ADDRESS,
  });

  logger.info(
    { url: `ws://${config.BARTLEBY_BIND_ADDRESS}:${server.port}` },
    'bartleby server listening',
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

// Bartleby server entrypoint. Boots:
//   - Hocuspocus WebSocket server (collab traffic; auth on WS lands in A-010)
//   - HTTP server with the auth routes (Workstream A)
// after validating env config and running pending migrations (Workstream D).

import { loadConfig } from './config.js';
import { openDatabase } from './db/open.js';
import { createLogger } from './logger.js';
import { runMigrations } from './migrate.js';
import { createBartlebyServer } from './server.js';
import { createBartlebyHttpServer } from './http.js';

export function placeholder(): string {
  return 'bartleby-server';
}

async function main(): Promise<void> {
  // 1. Validate env. Throws + exits if a required var is missing or a
  //    value violates its schema.
  const config = loadConfig();

  // 2. Structured logger from validated config.
  const logger = createLogger(config.LOG_LEVEL);

  logger.info(
    {
      wsPort: config.PORT,
      httpPort: config.HTTP_PORT,
      bind: config.BARTLEBY_BIND_ADDRESS,
      databasePath: config.BARTLEBY_DB_PATH,
    },
    'starting bartleby',
  );

  // 3. Run migrations idempotently.
  await runMigrations({ databasePath: config.BARTLEBY_DB_PATH, logger });

  // 4. Long-lived DB connection for the runtime process (separate from
  //    the one Hocuspocus's SQLite extension owns; SQLite WAL mode
  //    handles concurrent readers + a single writer per process).
  const db = openDatabase(config.BARTLEBY_DB_PATH);

  // 5. Boot the WS server. WS bind is configurable (Caddy fronts
  //    publicly in production).
  const ws = await createBartlebyServer({
    port: config.PORT,
    databasePath: config.BARTLEBY_DB_PATH,
    address: config.BARTLEBY_BIND_ADDRESS,
  });

  // 6. Boot the auth + notes HTTP server only if PUBLIC_BASE_URL is
  //    set — createBartlebyHttpServer needs it to build OAuth redirect
  //    URIs and downstream auth helpers also need
  //    BARTLEBY_ALLOWED_EMAILS / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
  //    Local dev and integ tests can run with just the WS server.
  let http: Awaited<ReturnType<typeof createBartlebyHttpServer>> | undefined;
  if (config.PUBLIC_BASE_URL !== undefined && config.PUBLIC_BASE_URL.length > 0) {
    http = await createBartlebyHttpServer({
      port: config.HTTP_PORT,
      env: process.env,
      db,
      logger,
    });
    logger.info(
      {
        ws: `ws://${config.BARTLEBY_BIND_ADDRESS}:${ws.port}`,
        http: `http://127.0.0.1:${http.port}`,
      },
      'bartleby listening (ws + http)',
    );
  } else {
    logger.warn(
      { ws: `ws://${config.BARTLEBY_BIND_ADDRESS}:${ws.port}` },
      'bartleby listening (ws only; PUBLIC_BASE_URL unset, HTTP/auth skipped)',
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    if (http !== undefined) {
      await http.close();
    }
    await ws.destroy();
    db.close();
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

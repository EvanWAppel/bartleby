// Bartleby server entrypoint. Boots a Hocuspocus instance.
// Phase 0: in-memory, no auth. V-010 swaps in SQLite persistence.

import { createBartlebyServer } from './server.js';

export function placeholder(): string {
  return 'bartleby-server';
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 1234);
  const databasePath = process.env.BARTLEBY_DB_PATH ?? ':memory:';
  const address = process.env.BARTLEBY_BIND_ADDRESS ?? '127.0.0.1';
  const server = await createBartlebyServer({ port, databasePath, address });
  console.log(`bartleby server listening on ws://${address}:${server.port} (db=${databasePath})`);

  const shutdown = async (): Promise<void> => {
    console.log('shutting down...');
    await server.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

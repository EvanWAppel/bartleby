// Bartleby server entrypoint. Boots:
//   - Hocuspocus WebSocket server (collab traffic; auth added in A-010)
//   - HTTP server with the auth routes (Workstream A)

import { createBartlebyServer } from './server.js';
import { createBartlebyHttpServer } from './http.js';

export function placeholder(): string {
  return 'bartleby-server';
}

async function main(): Promise<void> {
  const wsPort = Number(process.env.PORT ?? 1234);
  const httpPort = Number(process.env.HTTP_PORT ?? 3000);
  const databasePath = process.env.BARTLEBY_DB_PATH ?? ':memory:';

  const ws = await createBartlebyServer({ port: wsPort, databasePath });
  const http = await createBartlebyHttpServer({ port: httpPort, env: process.env });

  console.log(
    `bartleby ws://127.0.0.1:${ws.port} (db=${databasePath}); ` +
      `http://127.0.0.1:${http.port} (auth)`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('shutting down...');
    await http.close();
    await ws.destroy();
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

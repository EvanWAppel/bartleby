// Hocuspocus server factory.
// V-010: SQLite persistence via @hocuspocus/extension-sqlite. Pass
// `databasePath: ':memory:'` for ephemeral storage (default), or a file path
// for state that survives restart.

import { SQLite } from '@hocuspocus/extension-sqlite';
import { Server } from '@hocuspocus/server';

export interface BartlebyServerOptions {
  port: number;
  /**
   * SQLite database path. `':memory:'` (default) keeps state in RAM only.
   */
  databasePath?: string;
}

export interface BartlebyServer {
  readonly port: number;
  destroy(): Promise<void>;
}

export async function createBartlebyServer(
  options: BartlebyServerOptions,
): Promise<BartlebyServer> {
  const databasePath = options.databasePath ?? ':memory:';

  const server = new Server({
    port: options.port,
    address: '127.0.0.1',
    quiet: true,
    extensions: [
      new SQLite({
        database: databasePath,
      }),
    ],
  });

  await server.listen();

  return {
    port: options.port,
    async destroy() {
      await server.destroy();
    },
  };
}

// Hocuspocus server factory. Phase 0: in-memory, no auth, no persistence.
// V-010 will swap in SQLite persistence.

import { Server } from '@hocuspocus/server';

export interface BartlebyServerOptions {
  port: number;
}

export interface BartlebyServer {
  readonly port: number;
  destroy(): Promise<void>;
}

export async function createBartlebyServer(options: BartlebyServerOptions): Promise<BartlebyServer> {
  const server = new Server({
    port: options.port,
    address: '127.0.0.1',
    quiet: true,
  });

  await server.listen();

  return {
    port: options.port,
    async destroy() {
      await server.destroy();
    },
  };
}

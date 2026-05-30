// Hocuspocus server factory.
// V-010: SQLite persistence via @hocuspocus/extension-sqlite. Pass
// `databasePath: ':memory:'` for ephemeral storage (default), or a file path
// for state that survives restart.
// O-002: GET /health returns 200 with `{ status: "ok", db: "ok" }` when the
// SQLite extension can answer a trivial query, 503 otherwise.

import { SQLite } from '@hocuspocus/extension-sqlite';
import { Server } from '@hocuspocus/server';
import type { Extension } from '@hocuspocus/server';

export interface BartlebyServerOptions {
  port: number;
  /**
   * SQLite database path. `':memory:'` (default) keeps state in RAM only.
   */
  databasePath?: string;
  /**
   * Interface to bind. Defaults to `'127.0.0.1'` (loopback) for dev
   * safety; production deployments inside Docker should pass `'0.0.0.0'`.
   */
  address?: string;
  /**
   * Additional Hocuspocus extensions to mount alongside SQLite. S-009
   * passes the derived-state hook here. Default is empty so existing
   * bare-server tests stay unaffected.
   */
  extraExtensions?: Extension[];
}

export interface BartlebyServer {
  readonly port: number;
  destroy(): Promise<void>;
  /**
   * Test-only hook: the live SQLite extension. Production code should
   * never reach for this; the /health test uses it to simulate a broken
   * database by closing the underlying handle.
   */
  readonly _sqliteForTesting: SQLite;
}

export async function createBartlebyServer(
  options: BartlebyServerOptions,
): Promise<BartlebyServer> {
  const databasePath = options.databasePath ?? ':memory:';

  // Construct the SQLite extension up front so the /health hook can probe
  // its underlying better-sqlite3 handle (the extension exposes `.db`).
  const sqlite = new SQLite({ database: databasePath });

  const server = new Server({
    port: options.port,
    address: options.address ?? '127.0.0.1',
    quiet: true,
    extensions: [sqlite, ...(options.extraExtensions ?? [])],
    async onRequest({ request, response }) {
      if (request.url !== '/health') {
        return;
      }
      let dbOk = false;
      try {
        const row = sqlite.db?.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
        dbOk = row?.ok === 1;
      } catch {
        dbOk = false;
      }
      const status = dbOk ? 200 : 503;
      const body = JSON.stringify({
        status: dbOk ? 'ok' : 'error',
        db: dbOk ? 'ok' : 'error',
      });
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body);
      // Hocuspocus convention: throwing here short-circuits the default
      // "Welcome to Hocuspocus!" 200 response. Throwing null suppresses
      // re-throw (see Server.requestHandler in @hocuspocus/server).
      throw null;
    },
  });

  await server.listen();

  return {
    port: options.port,
    async destroy() {
      await server.destroy();
    },
    _sqliteForTesting: sqlite,
  };
}

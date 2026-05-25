import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBartlebyServer, type BartlebyServer } from './server.js';
import { getFreePort } from './test-helpers/free-port.js';

describe('GET /health (O-002)', () => {
  let server: BartlebyServer;
  let baseUrl: string;

  beforeEach(async () => {
    const port = await getFreePort();
    server = await createBartlebyServer({ port });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.destroy();
  });

  it('returns 200 with status/db both "ok" when the DB is queryable', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { status: string; db: string };
    expect(body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 with status/db both "error" when the SQLite handle is broken', async () => {
    // Close the underlying handle out from under the extension. Subsequent
    // .prepare() calls throw, which the /health hook catches and reports
    // as 503.
    server._sqliteForTesting.db?.close();

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; db: string };
    expect(body).toEqual({ status: 'error', db: 'error' });
  });

  it('does not interfere with the default Hocuspocus response for non-/health URLs', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    // Hocuspocus's built-in default — confirms our onRequest only intercepts
    // /health and falls through otherwise.
    const text = await res.text();
    expect(text).toBe('Welcome to Hocuspocus!');
  });
});

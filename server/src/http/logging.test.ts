import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import pino, { type Logger } from 'pino';
import { Writable } from 'node:stream';
import { requestLogger } from './logging.js';
import type { AuthVars } from '../auth/index.js';

interface LogEntry {
  level: string;
  msg: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  userId?: string;
  [key: string]: unknown;
}

function captureLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line) entries.push(JSON.parse(line) as LogEntry);
      }
      cb();
    },
  });
  return { logger: pino({ level: 'info' }, sink), entries };
}

describe('requestLogger (S-013)', () => {
  it('logs method + path + status + durationMs on success', async () => {
    const { logger, entries } = captureLogger();
    const app = new Hono();
    app.use('*', requestLogger(logger));
    app.get('/hello', (c) => c.text('ok'));

    const res = await app.request('/hello');
    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.method).toBe('GET');
    expect(e.path).toBe('/hello');
    expect(e.status).toBe(200);
    expect(typeof e.durationMs).toBe('number');
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs status on a 404', async () => {
    const { logger, entries } = captureLogger();
    const app = new Hono();
    app.use('*', requestLogger(logger));
    // no routes registered → hono returns its default 404

    await app.request('/nope');
    expect(entries[0]!.status).toBe(404);
  });

  it('includes userId when auth middleware set it on the context', async () => {
    const { logger, entries } = captureLogger();
    const app = new Hono<{ Variables: AuthVars }>();
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 'u-123',
        email: 'a@b',
        displayName: 'A',
        color: '#000',
        createdAt: new Date(0).toISOString(),
      });
      await next();
    });
    app.use('*', requestLogger(logger));
    app.get('/me', (c) => c.text('hi'));

    await app.request('/me');
    expect(entries[0]!.userId).toBe('u-123');
  });

  it('omits userId when no auth context is set', async () => {
    const { logger, entries } = captureLogger();
    const app = new Hono<{ Variables: AuthVars }>();
    app.use('*', requestLogger(logger));
    app.get('/anon', (c) => c.text('ok'));

    await app.request('/anon');
    expect(entries[0]!.userId).toBeUndefined();
  });
});

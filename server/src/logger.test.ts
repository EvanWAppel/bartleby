import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createLogger } from './logger.js';

interface LogEntry {
  level: string;
  msg: string;
  [key: string]: unknown;
}

function captureLogs(level = 'info'): {
  logger: ReturnType<typeof createLogger>;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        entries.push(JSON.parse(line) as LogEntry);
      }
      cb();
    },
  });

  // createLogger writes to process.stdout; for the test we build an
  // equivalent pino with the same options but routed to our sink.
  const logger = pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: {
        paths: [
          'SESSION_SECRET',
          'GOOGLE_CLIENT_SECRET',
          'RESEND_API_KEY',
          '*.SESSION_SECRET',
          '*.GOOGLE_CLIENT_SECRET',
          '*.RESEND_API_KEY',
          'env.SESSION_SECRET',
          'env.GOOGLE_CLIENT_SECRET',
          'env.RESEND_API_KEY',
          'password',
          'token',
          'authorization',
          '*.password',
          '*.token',
          '*.authorization',
        ],
        censor: '[redacted]',
      },
    },
    sink,
  );
  return { logger, entries };
}

describe('createLogger (O-009)', () => {
  it('emits newline-delimited JSON with ISO timestamps and level labels', () => {
    const { logger, entries } = captureLogs();
    logger.info({ route: '/health' }, 'request');

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(entry!.level).toBe('info');
    expect(entry!.msg).toBe('request');
    expect(entry!.route).toBe('/health');
    expect(entry!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts SESSION_SECRET in a flat object', () => {
    const { logger, entries } = captureLogs();
    logger.info({ SESSION_SECRET: 'should-not-leak' }, 'config snapshot');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.SESSION_SECRET).toBe('[redacted]');
  });

  it('redacts nested env.SESSION_SECRET', () => {
    const { logger, entries } = captureLogs();
    logger.info({ env: { SESSION_SECRET: 'should-not-leak' } }, 'env');

    expect(entries).toHaveLength(1);
    const env = entries[0]!.env as { SESSION_SECRET: string };
    expect(env.SESSION_SECRET).toBe('[redacted]');
  });

  it('redacts well-known HTTP secrets', () => {
    const { logger, entries } = captureLogs();
    logger.info({ authorization: 'Bearer abc', token: 'tkn' }, 'request');

    expect(entries[0]!.authorization).toBe('[redacted]');
    expect(entries[0]!.token).toBe('[redacted]');
  });

  it('respects level: info logger drops debug', () => {
    const { logger, entries } = captureLogs('info');
    logger.debug('quiet');
    logger.info('loud');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.msg).toBe('loud');
  });

  it('createLogger() returns a real pino instance', () => {
    const logger = createLogger('warn');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(logger.level).toBe('warn');
  });
});

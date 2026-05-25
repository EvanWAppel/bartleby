// Production-grade structured logger.
//
// Pino writes newline-delimited JSON to stdout. Docker / docker compose
// captures that into the container log stream, where Caddy and Litestream
// logs interleave fine because each line is independent JSON.
//
// SECRET_KEYS from config.ts is plumbed into pino's redact path so we
// can't accidentally log a session secret or API key.

import pino, { type Logger } from 'pino';
import { SECRET_KEYS } from './config.js';

const redactPaths: string[] = [
  // Top-level keys.
  ...SECRET_KEYS,
  // Nested env objects (e.g. when we log a config snapshot).
  ...SECRET_KEYS.map((k) => `*.${k}`),
  ...SECRET_KEYS.map((k) => `env.${k}`),
  // Common HTTP-y secrets in logged objects.
  'password',
  'token',
  'authorization',
  '*.password',
  '*.token',
  '*.authorization',
];

export function createLogger(level: string = 'info'): Logger {
  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: redactPaths,
      censor: '[redacted]',
    },
  });
}

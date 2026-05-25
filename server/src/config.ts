// Validated process.env. Centralizes every env var the server consumes
// so a typo or missing required value fails LOUDLY at startup instead
// of producing weird behavior at runtime.
//
// Today (Phase 1) most vars have safe defaults. Workstream A will add
// hard-required values (BARTLEBY_ALLOWED_EMAILS, GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, SESSION_SECRET); Workstream M adds RESEND_API_KEY.
// As those land, change the corresponding fields from `optional()` to
// required and `loadConfig` will start rejecting incomplete envs.

import { z } from 'zod';

const PortSchema = z.coerce.number().int().min(1).max(65_535).default(1234);

const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info');

export const ConfigSchema = z.object({
  // Networking + storage (defaulted; safe to omit).
  PORT: PortSchema,
  BARTLEBY_BIND_ADDRESS: z.string().default('127.0.0.1'),
  BARTLEBY_DB_PATH: z.string().default(':memory:'),
  LOG_LEVEL: LogLevelSchema,

  // Public URL (used by Workstream A for OAuth redirects and by M for
  // email links). Optional now; will become required when A lands.
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Workstream A — auth allowlist + Google OAuth + session signing.
  // Optional today (server boots fine without auth); flip to required
  // when A-001..A-005 ship.
  BARTLEBY_ALLOWED_EMAILS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 chars (use: openssl rand -hex 32)')
    .optional(),

  // Workstream M — @mention email via Resend.
  RESEND_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse and validate `process.env`. On failure, prints a human-readable
 * list of offending fields and throws — callers (main()) decide whether
 * to exit. We deliberately do not catch + exit in this function so it
 * stays testable.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/** Keys we redact when logging the config or anywhere downstream. */
export const SECRET_KEYS = ['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'RESEND_API_KEY'] as const;

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import pino from 'pino';
import type { Database } from 'better-sqlite3';
import { buildBartlebyHttpApp } from './http.js';
import { createTestDatabase } from './db/test-fixture.js';

const baseEnv = {
  SESSION_SECRET: 'z'.repeat(48),
  BARTLEBY_ALLOWED_EMAILS: 'alice@example.com',
  GOOGLE_CLIENT_ID: 'g-client',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  NODE_ENV: 'test',
};

describe('buildBartlebyHttpApp', () => {
  let db: Database;
  const logger = pino({ level: 'silent' });

  beforeEach(async () => {
    db = await createTestDatabase();
  });
  afterEach(() => {
    db.close();
  });

  function deps(): { db: Database; logger: typeof logger } {
    return { db, logger };
  }

  it('mounts /auth/google/start', async () => {
    const { app } = buildBartlebyHttpApp(baseEnv, deps());
    const res = await app.request('http://localhost:3000/auth/google/start');
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    expect(loc).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fgoogle%2Fcallback');
  });

  it('throws if PUBLIC_BASE_URL is missing', () => {
    const env = { ...baseEnv, PUBLIC_BASE_URL: undefined };
    expect(() => buildBartlebyHttpApp(env, deps())).toThrowError(/PUBLIC_BASE_URL/);
  });

  it('throws if BARTLEBY_ALLOWED_EMAILS is missing', () => {
    const env = { ...baseEnv, BARTLEBY_ALLOWED_EMAILS: undefined };
    expect(() => buildBartlebyHttpApp(env, deps())).toThrowError(/BARTLEBY_ALLOWED_EMAILS/);
  });

  it('throws if GOOGLE_CLIENT_ID is missing', () => {
    const env = { ...baseEnv, GOOGLE_CLIENT_ID: undefined };
    expect(() => buildBartlebyHttpApp(env, deps())).toThrowError(/GOOGLE_CLIENT_ID/);
  });

  it('throws if SESSION_SECRET is missing', () => {
    const env = { ...baseEnv, SESSION_SECRET: undefined };
    expect(() => buildBartlebyHttpApp(env, deps())).toThrowError(/SESSION_SECRET/);
  });

  it('/notes requires a session (401 without auth cookie)', async () => {
    const { app } = buildBartlebyHttpApp(baseEnv, deps());
    const res = await app.request('http://localhost:3000/notes');
    expect(res.status).toBe(401);
  });

  it('/search requires a session (401 without auth cookie)', async () => {
    const { app } = buildBartlebyHttpApp(baseEnv, deps());
    const res = await app.request('http://localhost:3000/search?q=hello');
    expect(res.status).toBe(401);
  });
});

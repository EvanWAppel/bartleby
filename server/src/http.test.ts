import { describe, it, expect } from 'vitest';
import { buildBartlebyHttpApp } from './http.js';

const baseEnv = {
  SESSION_SECRET: 'z'.repeat(48),
  BARTLEBY_ALLOWED_EMAILS: 'alice@example.com',
  GOOGLE_CLIENT_ID: 'g-client',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  NODE_ENV: 'test',
};

describe('buildBartlebyHttpApp', () => {
  it('mounts /auth/google/start', async () => {
    const { app } = buildBartlebyHttpApp(baseEnv);
    const res = await app.request('http://localhost:3000/auth/google/start');
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    expect(loc).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fgoogle%2Fcallback');
  });

  it('throws if PUBLIC_BASE_URL is missing', () => {
    const env = { ...baseEnv, PUBLIC_BASE_URL: undefined };
    expect(() => buildBartlebyHttpApp(env)).toThrowError(/PUBLIC_BASE_URL/);
  });

  it('throws if BARTLEBY_ALLOWED_EMAILS is missing', () => {
    const env = { ...baseEnv, BARTLEBY_ALLOWED_EMAILS: undefined };
    expect(() => buildBartlebyHttpApp(env)).toThrowError(/BARTLEBY_ALLOWED_EMAILS/);
  });

  it('throws if GOOGLE_CLIENT_ID is missing', () => {
    const env = { ...baseEnv, GOOGLE_CLIENT_ID: undefined };
    expect(() => buildBartlebyHttpApp(env)).toThrowError(/GOOGLE_CLIENT_ID/);
  });

  it('throws if SESSION_SECRET is missing', () => {
    const env = { ...baseEnv, SESSION_SECRET: undefined };
    expect(() => buildBartlebyHttpApp(env)).toThrowError(/SESSION_SECRET/);
  });
});

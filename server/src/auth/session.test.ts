import { describe, it, expect } from 'vitest';
import {
  buildSessionConfig,
  issueSessionJwt,
  verifySessionJwt,
  serializeSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE_NAME,
} from './session.js';

const cfg = buildSessionConfig({
  SESSION_SECRET: 'a'.repeat(48),
  NODE_ENV: 'test',
});

describe('session JWT (A-003)', () => {
  it('issues and verifies a signed session JWT', async () => {
    const token = await issueSessionJwt(cfg, {
      userId: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      color: '#aabbcc',
      jti: 'jti-1',
    });
    const claims = await verifySessionJwt(cfg, token);
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('alice@example.com');
    expect(claims.displayName).toBe('Alice');
    expect(claims.color).toBe('#aabbcc');
    expect(claims.jti).toBe('jti-1');
  });

  it('rejects a tampered JWT', async () => {
    const token = await issueSessionJwt(cfg, {
      userId: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      color: '#aabbcc',
      jti: 'jti-1',
    });
    const tampered = token.slice(0, -4) + 'AAAA';
    await expect(verifySessionJwt(cfg, tampered)).rejects.toThrow();
  });

  it('rejects a JWT signed with a different secret', async () => {
    const other = buildSessionConfig({
      SESSION_SECRET: 'b'.repeat(48),
      NODE_ENV: 'test',
    });
    const token = await issueSessionJwt(other, {
      userId: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      color: '#aabbcc',
      jti: 'jti-x',
    });
    await expect(verifySessionJwt(cfg, token)).rejects.toThrow();
  });
});

describe('session cookies (A-003)', () => {
  it('serializes a session cookie with HttpOnly and SameSite=Lax', () => {
    const c = serializeSessionCookie('the-token', { secure: false });
    expect(c).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=the-token`));
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Secure/);
  });

  it('adds Secure when secure=true', () => {
    const c = serializeSessionCookie('the-token', { secure: true });
    expect(c).toMatch(/Secure/);
  });

  it('clearSessionCookie produces an immediately-expiring cookie', () => {
    const c = clearSessionCookie({ secure: false });
    expect(c).toMatch(/Max-Age=0/);
    expect(c).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
  });

  it('parseCookies parses a Cookie header', () => {
    const out = parseCookies('a=1; b=two; c=three');
    expect(out.a).toBe('1');
    expect(out.b).toBe('two');
    expect(out.c).toBe('three');
  });

  it('parseCookies handles empty / missing headers', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});

describe('buildSessionConfig (A-003)', () => {
  it('throws if SESSION_SECRET is missing', () => {
    expect(() => buildSessionConfig({ NODE_ENV: 'test' })).toThrowError(/SESSION_SECRET/);
  });

  it('throws if SESSION_SECRET is short', () => {
    expect(() => buildSessionConfig({ SESSION_SECRET: 'short', NODE_ENV: 'test' })).toThrowError(
      /at least 32/,
    );
  });
});

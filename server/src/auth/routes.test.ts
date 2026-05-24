import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthApp } from './routes.js';
import { buildSessionConfig, SESSION_COOKIE_NAME } from './session.js';
import { loadAllowlist } from './allowlist.js';
import { createInMemorySessionStore, type SessionStore } from './store.js';
import type { GoogleClient } from './google.js';

const PUBLIC = 'http://localhost:3000';

function makeGoogleStub(overrides: Partial<GoogleClient> = {}): GoogleClient {
  return {
    buildAuthorizeUrl(state, redirectUri) {
      return `https://accounts.google.com/fake/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    },
    async exchangeCode() {
      return { accessToken: 'fake-access' };
    },
    async fetchUserInfo() {
      return { email: 'alice@example.com', displayName: 'Alice', emailVerified: true };
    },
    ...overrides,
  };
}

interface Harness {
  app: ReturnType<typeof createAuthApp>;
  store: SessionStore;
}

function makeHarness(
  opts: {
    google?: GoogleClient;
    allowedEmails?: string;
  } = {},
): Harness {
  const sessionConfig = buildSessionConfig({
    SESSION_SECRET: 'x'.repeat(48),
    NODE_ENV: 'test',
  });
  const allowlist = loadAllowlist({
    BARTLEBY_ALLOWED_EMAILS: opts.allowedEmails ?? 'alice@example.com,bob@example.com',
  });
  const store = createInMemorySessionStore();
  const google = opts.google ?? makeGoogleStub();
  const app = createAuthApp({
    sessionConfig,
    store,
    allowlist,
    google,
    appConfig: { publicBaseUrl: PUBLIC },
  });
  return { app, store };
}

/** Pull every Set-Cookie header from a hono Response. */
function getSetCookies(res: Response): string[] {
  const out: string[] = [];
  // hono+web-standard Response: getSetCookie() returns string[].
  const sc = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof sc === 'function') {
    return sc.call(res.headers);
  }
  // Fallback: single get('set-cookie') (may collapse; for our tests we always have it).
  const single = res.headers.get('set-cookie');
  if (single !== null) out.push(single);
  return out;
}

function pickCookie(setCookies: string[], name: string): string | null {
  for (const c of setCookies) {
    const m = c.match(new RegExp(`^${name}=([^;]*)`));
    if (m !== null) return m[1] ?? '';
  }
  return null;
}

describe('GET /auth/google/start (A-002)', () => {
  it('redirects to Google with a state cookie set', async () => {
    const { app } = makeHarness();
    const res = await app.request(`${PUBLIC}/auth/google/start`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^https:\/\/accounts\.google\.com\/fake\/authorize\?state=[0-9a-f]+/);

    const sc = getSetCookies(res);
    const state = pickCookie(sc, 'bartleby_oauth_state');
    expect(state).not.toBeNull();
    expect(state).toMatch(/^[0-9a-f]{32}$/);

    // Same state should appear in the Location URL.
    const url = new URL(location ?? '');
    expect(url.searchParams.get('state')).toBe(state);

    // Cookie should be HttpOnly + SameSite=Lax.
    const cookieLine = sc.find((c) => c.startsWith('bartleby_oauth_state='));
    expect(cookieLine).toMatch(/HttpOnly/);
    expect(cookieLine).toMatch(/SameSite=Lax/);
  });
});

describe('GET /auth/google/callback (A-002)', () => {
  async function startFlow(harness: Harness): Promise<{ state: string }> {
    const res = await harness.app.request(`${PUBLIC}/auth/google/start`);
    const sc = getSetCookies(res);
    const state = pickCookie(sc, 'bartleby_oauth_state') ?? '';
    return { state };
  }

  it('full happy path: exchange code, set session cookie, redirect to /', async () => {
    const harness = makeHarness();
    const { state } = await startFlow(harness);
    const url = `${PUBLIC}/auth/google/callback?code=goog-code&state=${state}`;
    const res = await harness.app.request(url, {
      headers: { cookie: `bartleby_oauth_state=${state}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${PUBLIC}/`);

    const sc = getSetCookies(res);
    const session = pickCookie(sc, SESSION_COOKIE_NAME);
    expect(session).not.toBeNull();
    expect(session?.length).toBeGreaterThan(20);

    // OAuth state cookie cleared (Max-Age=0).
    const stateLine = sc.find((c) => c.startsWith('bartleby_oauth_state='));
    expect(stateLine).toMatch(/Max-Age=0/);
  });

  it('rejects non-allowlisted email with 403; no session cookie set', async () => {
    const harness = makeHarness({
      google: makeGoogleStub({
        async fetchUserInfo() {
          return { email: 'eve@example.com', displayName: 'Eve', emailVerified: true };
        },
      }),
    });
    const { state } = await startFlow(harness);
    const res = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=${state}`,
      { headers: { cookie: `bartleby_oauth_state=${state}` } },
    );
    expect(res.status).toBe(403);
    const sc = getSetCookies(res);
    expect(pickCookie(sc, SESSION_COOKIE_NAME)).toBeNull();
  });

  it('rejects state mismatch with 400', async () => {
    const harness = makeHarness();
    const { state } = await startFlow(harness);
    const res = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=wrong`,
      { headers: { cookie: `bartleby_oauth_state=${state}` } },
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing state cookie with 400', async () => {
    const harness = makeHarness();
    const res = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=abc`,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me (A-003, A-004)', () => {
  it('returns 401 without a cookie', async () => {
    const { app } = makeHarness();
    const res = await app.request(`${PUBLIC}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('returns 401 with a tampered cookie', async () => {
    const { app } = makeHarness();
    const res = await app.request(`${PUBLIC}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not.a.jwt` },
    });
    expect(res.status).toBe(401);
  });

  it('returns the current user with id, email, display_name, color', async () => {
    const harness = makeHarness();
    // Run the OAuth flow to get a real session cookie.
    const startRes = await harness.app.request(`${PUBLIC}/auth/google/start`);
    const startCookies = getSetCookies(startRes);
    const state = pickCookie(startCookies, 'bartleby_oauth_state') ?? '';
    const cbRes = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=${state}`,
      { headers: { cookie: `bartleby_oauth_state=${state}` } },
    );
    const sessionCookie = pickCookie(getSetCookies(cbRes), SESSION_COOKIE_NAME) ?? '';
    expect(sessionCookie).not.toBe('');

    const meRes = await harness.app.request(`${PUBLIC}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` },
    });
    expect(meRes.status).toBe(200);
    const body = (await meRes.json()) as {
      id: string;
      email: string;
      display_name: string;
      color: string;
    };
    expect(body.email).toBe('alice@example.com');
    expect(body.display_name).toBe('Alice');
    expect(body.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(body.id.length).toBeGreaterThan(0);
  });
});

describe('POST /auth/logout (A-005)', () => {
  let harness: Harness;
  let sessionCookie: string;

  beforeEach(async () => {
    harness = makeHarness();
    const startRes = await harness.app.request(`${PUBLIC}/auth/google/start`);
    const startCookies = getSetCookies(startRes);
    const state = pickCookie(startCookies, 'bartleby_oauth_state') ?? '';
    const cbRes = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=${state}`,
      { headers: { cookie: `bartleby_oauth_state=${state}` } },
    );
    sessionCookie = pickCookie(getSetCookies(cbRes), SESSION_COOKIE_NAME) ?? '';
  });

  it('clears the session cookie', async () => {
    const res = await harness.app.request(`${PUBLIC}/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` },
    });
    expect(res.status).toBe(200);
    const sc = getSetCookies(res);
    const cleared = sc.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it('revokes the jti so the same cookie no longer authorizes /auth/me', async () => {
    // Pre-condition: /auth/me works.
    const meBefore = await harness.app.request(`${PUBLIC}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` },
    });
    expect(meBefore.status).toBe(200);

    // Logout.
    await harness.app.request(`${PUBLIC}/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` },
    });

    // Post-condition: same cookie now 401.
    const meAfter = await harness.app.request(`${PUBLIC}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` },
    });
    expect(meAfter.status).toBe(401);
  });

  it('returns 200 even when called without a session', async () => {
    const res = await harness.app.request(`${PUBLIC}/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

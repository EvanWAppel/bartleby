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

describe('device-code flow (A-006..A-009)', () => {
  async function signIn(harness: Harness): Promise<string> {
    const startRes = await harness.app.request(`${PUBLIC}/auth/google/start`);
    const startCookies = getSetCookies(startRes);
    const state = pickCookie(startCookies, 'bartleby_oauth_state') ?? '';
    const cbRes = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=${state}`,
      { headers: { cookie: `bartleby_oauth_state=${state}` } },
    );
    return pickCookie(getSetCookies(cbRes), SESSION_COOKIE_NAME) ?? '';
  }

  it('POST /auth/device/start returns device-code shape and stores a pending row (A-006)', async () => {
    const harness = makeHarness();
    const res = await harness.app.request(`${PUBLIC}/auth/device/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
      expires_in: number;
    };
    expect(body.device_code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.verification_uri).toBe(`${PUBLIC}/device`);
    expect(body.interval).toBeGreaterThan(0);
    expect(body.expires_in).toBeGreaterThan(0);

    const stored = await harness.store.getDeviceAuthorizationByCode(body.device_code);
    expect(stored?.userCode).toBe(body.user_code);
    expect(stored?.approvedUserId).toBeNull();
  });

  it('GET /device redirects unauthenticated users to OAuth and returns after callback (A-007)', async () => {
    const harness = makeHarness();
    const deviceRes = await harness.app.request(`${PUBLIC}/device?user_code=ABCD-1234`);
    expect(deviceRes.status).toBe(302);
    expect(deviceRes.headers.get('location')).toBe('/auth/google/start');
    const returnCookie = getSetCookies(deviceRes).find((c) =>
      c.startsWith('bartleby_post_login_redirect='),
    );
    expect(returnCookie).toContain(encodeURIComponent('/device?user_code=ABCD-1234'));

    const startRes = await harness.app.request(`${PUBLIC}/auth/google/start`, {
      headers: { cookie: returnCookie ?? '' },
    });
    const state = pickCookie(getSetCookies(startRes), 'bartleby_oauth_state') ?? '';
    const cbRes = await harness.app.request(
      `${PUBLIC}/auth/google/callback?code=goog-code&state=${state}`,
      {
        headers: {
          cookie: `bartleby_oauth_state=${state}; ${returnCookie ?? ''}`,
        },
      },
    );
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.get('location')).toBe(`${PUBLIC}/device?user_code=ABCD-1234`);
  });

  it('POST /device/approve attaches the authenticated user to the user_code (A-007)', async () => {
    const harness = makeHarness();
    const start = await harness.app.request(`${PUBLIC}/auth/device/start`, { method: 'POST' });
    const started = (await start.json()) as { device_code: string; user_code: string };
    const sessionCookie = await signIn(harness);

    const res = await harness.app.request(`${PUBLIC}/device/approve`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ user_code: started.user_code }),
    });
    expect(res.status).toBe(200);
    const stored = await harness.store.getDeviceAuthorizationByCode(started.device_code);
    expect(stored?.approvedUserId).toBeTruthy();
  });

  it('POST /auth/device/poll returns 428 while pending, then access+refresh tokens once approved (A-008)', async () => {
    const harness = makeHarness();
    const start = await harness.app.request(`${PUBLIC}/auth/device/start`, { method: 'POST' });
    const started = (await start.json()) as { device_code: string; user_code: string };

    const pending = await harness.app.request(`${PUBLIC}/auth/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: started.device_code }),
    });
    expect(pending.status).toBe(428);

    const sessionCookie = await signIn(harness);
    await harness.app.request(`${PUBLIC}/device/approve`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ user_code: started.user_code }),
    });

    const approved = await harness.app.request(`${PUBLIC}/auth/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: started.device_code }),
    });
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(body.token_type).toBe('Bearer');
    expect(body.access_token.length).toBeGreaterThan(20);
    expect(body.refresh_token.length).toBeGreaterThan(20);
    expect(body.expires_in).toBe(15 * 60);
  });

  it('POST /auth/device/poll returns 410 for expired device codes (A-008)', async () => {
    const harness = makeHarness();
    const past = new Date(Date.now() - 1_000);
    const row = await harness.store.createDeviceAuthorization({
      deviceCode: 'expired-device-code',
      userCode: 'OLD1-CODE',
      verificationUri: `${PUBLIC}/device`,
      intervalSeconds: 5,
      expiresAt: past,
    });
    expect(row.expiresAt).toBe(past);
    const res = await harness.app.request(`${PUBLIC}/auth/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: 'expired-device-code' }),
    });
    expect(res.status).toBe(410);
  });

  it('POST /auth/token/refresh rotates a valid refresh token and rejects revoked tokens (A-009)', async () => {
    const harness = makeHarness();
    const start = await harness.app.request(`${PUBLIC}/auth/device/start`, { method: 'POST' });
    const started = (await start.json()) as { device_code: string; user_code: string };
    const sessionCookie = await signIn(harness);
    await harness.app.request(`${PUBLIC}/device/approve`, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ user_code: started.user_code }),
    });
    const poll = await harness.app.request(`${PUBLIC}/auth/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: started.device_code }),
    });
    const issued = (await poll.json()) as { refresh_token: string };

    const refreshed = await harness.app.request(`${PUBLIC}/auth/token/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: issued.refresh_token }),
    });
    expect(refreshed.status).toBe(200);
    const rotated = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(rotated.access_token.length).toBeGreaterThan(20);
    expect(rotated.refresh_token).not.toBe(issued.refresh_token);

    const reused = await harness.app.request(`${PUBLIC}/auth/token/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: issued.refresh_token }),
    });
    expect(reused.status).toBe(401);
  });
});

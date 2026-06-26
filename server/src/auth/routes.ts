// Auth routes: Google OAuth start/callback, /auth/me, /auth/logout.
// (A-002, A-003, A-004, A-005)
//
// Tests inject GoogleClient + SessionStore + EmailAllowlist. The production
// wiring lives in src/http.ts.

import { Hono, type Context } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { type EmailAllowlist } from './allowlist.js';
import {
  type SessionConfig,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  serializeSessionCookie,
  clearSessionCookie,
  issueSessionJwt,
  verifySessionJwt,
  parseCookies,
} from './session.js';
import { type SessionStore } from './store.js';
import { type GoogleClient } from './google.js';
import { requireSession, type AuthVars } from './middleware.js';
import type { Repositories } from '../db/repositories/index.js';
import { ensureUserExists } from '../notes/ensure-user.js';

const OAUTH_STATE_COOKIE = 'bartleby_oauth_state';
const OAUTH_STATE_MAX_AGE_SECONDS = 600;
const POST_LOGIN_REDIRECT_COOKIE = 'bartleby_post_login_redirect';
const DEVICE_CODE_EXPIRES_IN_SECONDS = 10 * 60;
const DEVICE_CODE_POLL_INTERVAL_SECONDS = 5;

export interface AuthAppConfig {
  /** External base URL (no trailing slash), e.g. http://localhost:3000. */
  publicBaseUrl: string;
  /** Where to redirect after a successful login. Defaults to "/". */
  postLoginRedirect?: string;
}

export interface AuthAppDeps {
  sessionConfig: SessionConfig;
  store: SessionStore;
  allowlist: EmailAllowlist;
  google: GoogleClient;
  appConfig: AuthAppConfig;
  /** Optional D repos; when provided, the OAuth callback bridges the
   * session user into D's `users` table so subsequent mention
   * extraction can resolve them by email. */
  repos?: Repositories;
}

type AuthContext = Context<{ Variables: AuthVars }>;

function buildRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/auth/google/callback`;
}

function serializeOauthStateCookie(value: string, secure: boolean): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${value === '' ? 0 : OAUTH_STATE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function serializePostLoginRedirectCookie(value: string, secure: boolean): string {
  const encoded = encodeURIComponent(value);
  const parts = [
    `${POST_LOGIN_REDIRECT_COOKIE}=${encoded}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${value === '' ? 0 : OAUTH_STATE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function safeReturnTo(value: string | undefined): string {
  if (value === undefined || value.length === 0) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return '/';
  }
  if (!decoded.startsWith('/')) return '/';
  if (decoded.startsWith('//')) return '/';
  return decoded;
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function randomUserCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    const idx = randomBytes(1)[0]! % alphabet.length;
    out += alphabet[idx];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

async function parseJsonBody(c: AuthContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function stringField(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function issueDeviceTokenPair(
  deps: AuthAppDeps,
  user: { id: string; email: string; displayName: string; color: string },
): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}> {
  const accessJti = randomUUID();
  const accessToken = await issueSessionJwt(deps.sessionConfig, {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    color: user.color,
    jti: accessJti,
    ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });
  const refreshToken = randomBase64Url(32);
  await deps.store.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export function createAuthApp(deps: AuthAppDeps): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  const redirectUri = buildRedirectUri(deps.appConfig.publicBaseUrl);
  const postLoginRedirect = deps.appConfig.postLoginRedirect ?? '/';
  const secure = deps.sessionConfig.secureCookies;

  app.get('/auth/google/start', (c) => {
    const state = randomBytes(16).toString('hex');
    const authorizeUrl = deps.google.buildAuthorizeUrl(state, redirectUri);
    c.header('set-cookie', serializeOauthStateCookie(state, secure));
    return c.redirect(authorizeUrl, 302);
  });

  app.get('/auth/google/callback', async (c) => {
    const code = c.req.query('code');
    const stateFromQuery = c.req.query('state');
    if (typeof code !== 'string' || code.length === 0) {
      return c.json({ error: { code: 'bad_request', message: 'missing code' } }, 400);
    }
    if (typeof stateFromQuery !== 'string' || stateFromQuery.length === 0) {
      return c.json({ error: { code: 'bad_request', message: 'missing state' } }, 400);
    }
    const cookies = parseCookies(c.req.header('cookie'));
    const stateFromCookie = cookies[OAUTH_STATE_COOKIE];
    if (stateFromCookie === undefined || stateFromCookie !== stateFromQuery) {
      return c.json({ error: { code: 'bad_request', message: 'state mismatch' } }, 400);
    }

    const { accessToken } = await deps.google.exchangeCode({ code, redirectUri });
    const info = await deps.google.fetchUserInfo(accessToken);

    if (!deps.allowlist.has(info.email)) {
      // Clear the oauth state cookie regardless.
      c.header('set-cookie', serializeOauthStateCookie('', secure));
      return c.json(
        {
          error: {
            code: 'forbidden',
            message: 'this email is not on the Bartleby allowlist',
          },
        },
        403,
      );
    }

    const user = await deps.store.upsertUserByEmail({
      email: info.email,
      displayName: info.displayName,
    });
    if (deps.repos !== undefined) {
      ensureUserExists(deps.repos.users, user);
    }
    const jti = randomUUID();
    const token = await issueSessionJwt(deps.sessionConfig, {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      color: user.color,
      jti,
    });

    // Two Set-Cookie headers: clear oauth state + set session.
    c.header('set-cookie', serializeOauthStateCookie('', secure), { append: true });
    c.header('set-cookie', serializeSessionCookie(token, { secure }), { append: true });
    const returnTo = safeReturnTo(cookies[POST_LOGIN_REDIRECT_COOKIE]);
    c.header('set-cookie', serializePostLoginRedirectCookie('', secure), { append: true });
    return c.redirect(
      `${deps.appConfig.publicBaseUrl.replace(/\/$/, '')}${
        returnTo === '/' ? postLoginRedirect : returnTo
      }`,
      302,
    );
  });

  const gate = requireSession({ sessionConfig: deps.sessionConfig, store: deps.store });

  app.get('/auth/me', gate, (c) => {
    const user = c.get('user');
    return c.json({
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      color: user.color,
    });
  });

  app.post('/auth/logout', async (c) => {
    // Logout is best-effort: if there's a valid session, revoke its jti.
    // Either way, clear the cookie and respond 200.
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[SESSION_COOKIE_NAME];
    if (typeof token === 'string' && token.length > 0) {
      try {
        const claims = await verifySessionJwt(deps.sessionConfig, token);
        await deps.store.revokeJti(claims.jti);
      } catch {
        // Invalid token → nothing to revoke; still clear the cookie.
      }
    }
    c.header('set-cookie', clearSessionCookie({ secure }));
    return c.json({ ok: true });
  });

  app.post('/auth/device/start', async (c) => {
    const row = await deps.store.createDeviceAuthorization({
      deviceCode: randomBase64Url(32),
      userCode: randomUserCode(),
      verificationUri: `${deps.appConfig.publicBaseUrl.replace(/\/$/, '')}/device`,
      intervalSeconds: DEVICE_CODE_POLL_INTERVAL_SECONDS,
      expiresAt: new Date(Date.now() + DEVICE_CODE_EXPIRES_IN_SECONDS * 1000),
    });
    return c.json({
      device_code: row.deviceCode,
      user_code: row.userCode,
      verification_uri: row.verificationUri,
      interval: row.intervalSeconds,
      expires_in: DEVICE_CODE_EXPIRES_IN_SECONDS,
    });
  });

  app.get('/device', async (c) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[SESSION_COOKIE_NAME];
    if (token === undefined || token.length === 0) {
      const returnTo = `${new URL(c.req.url).pathname}${new URL(c.req.url).search}`;
      c.header('set-cookie', serializePostLoginRedirectCookie(returnTo, secure));
      return c.redirect('/auth/google/start', 302);
    }
    try {
      const claims = await verifySessionJwt(deps.sessionConfig, token);
      if (await deps.store.isJtiRevoked(claims.jti)) {
        throw new Error('session revoked');
      }
      const user = await deps.store.getUserById(claims.sub);
      if (user === null) {
        throw new Error('user missing');
      }
      c.set('user', user);
      c.set('sessionClaims', claims);
    } catch {
      const returnTo = `${new URL(c.req.url).pathname}${new URL(c.req.url).search}`;
      c.header('set-cookie', serializePostLoginRedirectCookie(returnTo, secure));
      return c.redirect('/auth/google/start', 302);
    }
    const userCode = c.req.query('user_code') ?? '';
    const escaped = userCode.replace(/[&<>"']/g, (ch) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[ch] ?? ch;
    });
    return c.html(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Bartleby device approval</title></head>
  <body>
    <main>
      <h1>Approve device</h1>
      <form method="post" action="/device/approve">
        <label>User code <input name="user_code" value="${escaped}" autocomplete="one-time-code"></label>
        <button type="submit">Approve</button>
      </form>
    </main>
  </body>
</html>`);
  });

  app.post('/device/approve', gate, async (c) => {
    const body = await c.req.parseBody();
    const userCode = body['user_code'];
    if (typeof userCode !== 'string' || userCode.length === 0) {
      return c.json({ error: { code: 'bad_request', message: 'missing user_code' } }, 400);
    }
    const allCaps = userCode.trim().toUpperCase();
    try {
      await deps.store.approveDeviceAuthorization({
        userCode: allCaps,
        userId: c.get('user').id,
      });
    } catch {
      return c.json({ error: { code: 'not_found', message: 'unknown user_code' } }, 404);
    }
    return c.json({ ok: true });
  });

  app.post('/auth/device/poll', async (c) => {
    const body = await parseJsonBody(c);
    const deviceCode = stringField(body, 'device_code');
    if (deviceCode === null) {
      return c.json({ error: { code: 'bad_request', message: 'missing device_code' } }, 400);
    }
    const row = await deps.store.getDeviceAuthorizationByCode(deviceCode);
    if (row === null) {
      return c.json({ error: { code: 'not_found', message: 'unknown device_code' } }, 404);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return c.json({ error: { code: 'expired', message: 'device_code expired' } }, 410);
    }
    if (row.approvedUserId === null) {
      return c.json({ error: { code: 'authorization_pending', message: 'pending approval' } }, 428);
    }
    const user = await deps.store.getUserById(row.approvedUserId);
    if (user === null) {
      return c.json({ error: { code: 'unauthenticated', message: 'approved user missing' } }, 401);
    }
    return c.json(await issueDeviceTokenPair(deps, user));
  });

  app.post('/auth/token/refresh', async (c) => {
    const body = await parseJsonBody(c);
    const refreshToken = stringField(body, 'refresh_token');
    if (refreshToken === null) {
      return c.json({ error: { code: 'bad_request', message: 'missing refresh_token' } }, 400);
    }
    const row = await deps.store.getRefreshToken(refreshToken);
    if (row === null || row.revokedAt !== null || row.expiresAt.getTime() <= Date.now()) {
      return c.json({ error: { code: 'unauthenticated', message: 'invalid refresh token' } }, 401);
    }
    const user = await deps.store.getUserById(row.userId);
    if (user === null) {
      return c.json({ error: { code: 'unauthenticated', message: 'user not found' } }, 401);
    }
    await deps.store.revokeRefreshToken(refreshToken);
    return c.json(await issueDeviceTokenPair(deps, user));
  });

  return app;
}

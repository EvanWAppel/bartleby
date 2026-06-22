// Auth routes: Google OAuth start/callback, /auth/me, /auth/logout.
// (A-002, A-003, A-004, A-005)
//
// Tests inject GoogleClient + SessionStore + EmailAllowlist. The production
// wiring lives in src/http.ts.

import { Hono } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { type EmailAllowlist } from './allowlist.js';
import {
  type SessionConfig,
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
    return c.redirect(
      `${deps.appConfig.publicBaseUrl.replace(/\/$/, '')}${postLoginRedirect}`,
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

  return app;
}

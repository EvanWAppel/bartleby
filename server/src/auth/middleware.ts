// Session-gate middleware for hono (A-003). Accepts either:
//   1. A `bartleby_session` cookie (web flow), or
//   2. An `Authorization: Bearer <jwt>` header (TUI / device-code flow, T-024).
// Both carry the same JWT shape (signed via SESSION_SECRET). The middleware
// verifies the JWT, checks the jti denylist, loads the user, and attaches
// it to the context. 401 on any failure path.

import type { MiddlewareHandler } from 'hono';
import {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionJwt,
  type SessionConfig,
  type SessionClaims,
} from './session.js';
import type { SessionStore, User } from './store.js';

export interface AuthVars {
  user: User;
  sessionClaims: SessionClaims;
}

export interface RequireSessionDeps {
  sessionConfig: SessionConfig;
  store: SessionStore;
}

const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined || header.length === 0) return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export function requireSession(
  deps: RequireSessionDeps,
): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    const bearerToken = extractBearerToken(c.req.header('authorization'));
    const token =
      bearerToken !== null && bearerToken.length > 0
        ? bearerToken
        : cookieToken !== undefined && cookieToken.length > 0
          ? cookieToken
          : null;
    if (token === null) {
      return c.json({ error: { code: 'unauthenticated', message: 'no session' } }, 401);
    }
    let claims: SessionClaims;
    try {
      claims = await verifySessionJwt(deps.sessionConfig, token);
    } catch {
      return c.json({ error: { code: 'unauthenticated', message: 'invalid session' } }, 401);
    }
    if (await deps.store.isJtiRevoked(claims.jti)) {
      return c.json({ error: { code: 'unauthenticated', message: 'session revoked' } }, 401);
    }
    const user = await deps.store.getUserById(claims.sub);
    if (user === null) {
      return c.json({ error: { code: 'unauthenticated', message: 'user not found' } }, 401);
    }
    c.set('user', user);
    c.set('sessionClaims', claims);
    await next();
  };
}

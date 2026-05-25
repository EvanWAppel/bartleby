// Session-gate middleware for hono (A-003). Reads bartleby_session cookie,
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

export function requireSession(
  deps: RequireSessionDeps,
): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[SESSION_COOKIE_NAME];
    if (token === undefined || token.length === 0) {
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

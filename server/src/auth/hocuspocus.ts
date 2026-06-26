// A-010: Hocuspocus authentication.
//
// We accept TWO authentication paths so the same hook serves both clients:
//
//   1. Bearer JWT (TUI / device-code clients, T-003).
//      Hocuspocus clients send a token immediately after the WebSocket
//      opens via the Hocuspocus Auth message; this hook validates the
//      same signed JWT shape used for HTTP access tokens.
//
//   2. Signed session cookie (web client, Editor.svelte / MobileReader).
//      The web client doesn't send a token — it relies on the
//      `bartleby_session` cookie established by the OAuth flow. The
//      cookie travels in the WebSocket upgrade request's `Cookie`
//      header, which `onAuthenticate` exposes as `requestHeaders`. We
//      verify it with the same `verifySessionJwt` used by HTTP
//      middleware (see auth/middleware.ts).
//
// Either successful path attaches `{ user }` to the Hocuspocus
// connection context. Only when BOTH fail do we reject.

import type { Extension } from '@hocuspocus/server';
import {
  parseCookies,
  SESSION_COOKIE_NAME,
  verifySessionJwt,
  type SessionClaims,
  type SessionConfig,
} from './session.js';
import type { SessionStore, User } from './store.js';

export interface HocuspocusAuthContext {
  user: User;
}

export interface HocuspocusAuthDeps {
  sessionConfig: SessionConfig;
  store: SessionStore;
}

function extractBearerToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice('bearer '.length).trim();
  }
  return trimmed;
}

/**
 * Hocuspocus delivers headers as either a `Headers` instance (Node 18+
 * fetch-style) or a plain `IncomingHttpHeaders` object depending on the
 * version. Normalize to a string lookup that's case-insensitive.
 */
function readHeader(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get(name);
    return value === null ? undefined : value;
  }
  const lower = name.toLowerCase();
  const raw = (headers as Record<string, string | string[] | undefined>)[lower];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw.join('; ') : raw;
}

async function verifyBearer(
  deps: HocuspocusAuthDeps,
  bearer: string,
): Promise<{ user: User; claims: SessionClaims } | { error: string }> {
  let claims: SessionClaims;
  try {
    claims = await verifySessionJwt(deps.sessionConfig, bearer);
  } catch {
    return { error: 'invalid bearer token' };
  }
  if (await deps.store.isJtiRevoked(claims.jti)) {
    return { error: 'revoked bearer token' };
  }
  const user = await deps.store.getUserById(claims.sub);
  if (user === null) {
    return { error: 'bearer token user not found' };
  }
  return { user, claims };
}

async function verifyCookie(
  deps: HocuspocusAuthDeps,
  cookieHeader: string | undefined,
): Promise<{ user: User; claims: SessionClaims } | { error: string }> {
  if (cookieHeader === undefined || cookieHeader.length === 0) {
    return { error: 'no session cookie' };
  }
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token === undefined || token.length === 0) {
    return { error: 'no session cookie' };
  }
  let claims: SessionClaims;
  try {
    claims = await verifySessionJwt(deps.sessionConfig, token);
  } catch {
    return { error: 'invalid session cookie' };
  }
  if (await deps.store.isJtiRevoked(claims.jti)) {
    return { error: 'revoked session cookie' };
  }
  const user = await deps.store.getUserById(claims.sub);
  if (user === null) {
    return { error: 'session cookie user not found' };
  }
  return { user, claims };
}

export function createHocuspocusAuthExtension(
  deps: HocuspocusAuthDeps,
): Extension<HocuspocusAuthContext> {
  return {
    extensionName: 'bartleby-auth',
    async onAuthenticate({ token, requestHeaders }) {
      // Path 1: Bearer token (TUI / device-code clients).
      const bearer = extractBearerToken(token ?? '');
      if (bearer.length > 0) {
        const result = await verifyBearer(deps, bearer);
        if ('user' in result) {
          return { user: result.user };
        }
        // Bearer was provided but failed — do NOT silently fall back to
        // a cookie. A client that presents a token is asserting which
        // identity it wants; honoring a different cookie identity would
        // be confusing and a footgun for token rotation.
        throw new Error(result.error);
      }

      // Path 2: Signed session cookie (web client).
      const cookieHeader = readHeader(requestHeaders, 'cookie');
      const result = await verifyCookie(deps, cookieHeader);
      if ('user' in result) {
        return { user: result.user };
      }
      throw new Error(result.error);
    },
  };
}

// A-010: Hocuspocus bearer-token authentication.
//
// Hocuspocus clients send an authentication token immediately after the
// WebSocket opens. We validate the same signed JWT shape used for device
// access tokens, check the jti denylist, load the user, and attach it to
// the Hocuspocus connection context for downstream hooks.

import type { Extension } from '@hocuspocus/server';
import { verifySessionJwt, type SessionConfig } from './session.js';
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

export function createHocuspocusAuthExtension(
  deps: HocuspocusAuthDeps,
): Extension<HocuspocusAuthContext> {
  return {
    extensionName: 'bartleby-auth',
    async onAuthenticate({ token }) {
      const bearer = extractBearerToken(token);
      if (bearer.length === 0) {
        throw new Error('missing bearer token');
      }
      let claims;
      try {
        claims = await verifySessionJwt(deps.sessionConfig, bearer);
      } catch {
        throw new Error('invalid bearer token');
      }
      if (await deps.store.isJtiRevoked(claims.jti)) {
        throw new Error('revoked bearer token');
      }
      const user = await deps.store.getUserById(claims.sub);
      if (user === null) {
        throw new Error('bearer token user not found');
      }
      return { user };
    },
  };
}

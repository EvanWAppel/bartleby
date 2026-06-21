// W-013: GET /users — the @mention picker's data source.
//
// We expose the union of the email allowlist and the in-memory users
// table. Every allowlist row is present; signed-in users get their
// display_name/user_id/color filled in. The allowlist is authoritative
// — a user who has signed in but is no longer on the allowlist drops
// off this list (the picker should never offer mentions the operator
// has deliberately revoked).
//
// Email is the stable identifier the mention node carries through to
// M-001's mention extractor; user_id is best-effort (null for un-
// signed-in friends).
//
// Auth gating is applied by the parent http.ts router via requireSession.
// This module returns a plain hono app so http.ts can compose it the
// same way notes/search are composed.

import { Hono } from 'hono';
import type { EmailAllowlist } from '../auth/allowlist.js';
import type { AuthVars, SessionStore } from '../auth/index.js';

export interface UsersAppDeps {
  allowlist: EmailAllowlist;
  store: SessionStore;
}

interface UsersRow {
  email: string;
  display_name: string | null;
  user_id: string | null;
  color: string | null;
  signed_in: boolean;
}

export function createUsersApp(deps: UsersAppDeps): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get('/users', async (c) => {
    const allowlistEmails = deps.allowlist.values();
    const signedIn = await deps.store.listUsers();
    const signedInByEmail = new Map(signedIn.map((u) => [u.email, u]));
    const rows: UsersRow[] = allowlistEmails
      .map((email) => {
        const user = signedInByEmail.get(email);
        if (user === undefined) {
          return {
            email,
            display_name: null,
            user_id: null,
            color: null,
            signed_in: false,
          };
        }
        return {
          email,
          display_name: user.displayName,
          user_id: user.id,
          color: user.color,
          signed_in: true,
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));
    return c.json({ users: rows });
  });

  return app;
}

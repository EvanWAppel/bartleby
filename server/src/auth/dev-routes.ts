// Test-only auth bypass for Playwright + local dev.
//
// `POST /auth/dev/sign-in` upserts a user by email via the SessionStore,
// mints a session JWT, and returns it via Set-Cookie — exactly the same
// shape the real Google callback produces. The mount in http.ts is
// gated on `ALLOW_TEST_SIGN_IN=true`, so production deployments never
// expose this route.
//
// Tests use this to skip OAuth entirely: hit the endpoint with the
// desired test user, the browser context picks up the Set-Cookie, all
// subsequent requests are authenticated end-to-end.

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { issueSessionJwt, SESSION_TTL_SECONDS, serializeSessionCookie } from './session.js';
import type { SessionConfig } from './session.js';
import type { SessionStore } from './store.js';

export interface DevAuthAppDeps {
  sessionConfig: SessionConfig;
  store: SessionStore;
}

interface SignInBody {
  email?: unknown;
  displayName?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function createDevAuthApp(deps: DevAuthAppDeps): Hono {
  const app = new Hono();

  app.post('/auth/dev/sign-in', async (c) => {
    let body: SignInBody;
    try {
      body = (await c.req.json()) as SignInBody;
    } catch {
      return c.json({ error: { code: 'validation_failed', message: 'body must be JSON' } }, 400);
    }
    const email = asString(body.email);
    if (email === undefined) {
      return c.json(
        { error: { code: 'validation_failed', message: 'email is required (string)' } },
        400,
      );
    }
    const displayName = asString(body.displayName) ?? email.split('@')[0]!;
    const user = await deps.store.upsertUserByEmail({ email, displayName });

    const jti = randomUUID();
    const token = await issueSessionJwt(deps.sessionConfig, {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      color: user.color,
      jti,
    });

    const cookie = serializeSessionCookie(token, {
      secure: deps.sessionConfig.secureCookies,
      maxAgeSeconds: SESSION_TTL_SECONDS,
    });
    c.header('Set-Cookie', cookie);
    return c.json({
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      color: user.color,
    });
  });

  return app;
}

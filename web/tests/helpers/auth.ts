// Playwright auth helper. The test bartleby server boots with HTTP
// enabled (see playwright.config.ts) using a known SESSION_SECRET.
// This helper mints a matching session JWT and drops it onto the
// browser context as the `bartleby_session` cookie, so tests skip
// the OAuth dance entirely.
//
// Mirrors the payload shape in server/src/auth/session.ts.

import { SignJWT } from 'jose';
import type { BrowserContext } from '@playwright/test';

export const SESSION_SECRET = 'test-only-session-secret-must-be-at-least-32-chars';
export const SESSION_COOKIE_NAME = 'bartleby_session';
const SESSION_JWT_ISSUER = 'bartleby';
const SESSION_JWT_AUDIENCE = 'bartleby-web';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  color: string;
}

export const DEFAULT_TEST_USER: TestUser = {
  id: 'u-test-1',
  email: 'test@example.com',
  displayName: 'Test User',
  color: '#3366cc',
};

async function mintSession(user: TestUser): Promise<string> {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  const jti = crypto.randomUUID();
  return await new SignJWT({
    email: user.email,
    displayName: user.displayName,
    color: user.color,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(SESSION_JWT_ISSUER)
    .setAudience(SESSION_JWT_AUDIENCE)
    .setSubject(user.id)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);
}

/** Drop a valid `bartleby_session` cookie onto the context. */
export async function signIn(
  context: BrowserContext,
  user: TestUser = DEFAULT_TEST_USER,
): Promise<void> {
  const token = await mintSession(user);
  // Use `url` rather than `domain` — bare IPs don't play nicely with
  // cookie `domain` matching, and the url form does the right thing.
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      url: 'http://127.0.0.1:5173',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

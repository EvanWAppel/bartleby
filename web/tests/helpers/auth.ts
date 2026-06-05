// Playwright auth helper. The test bartleby server boots with
// ALLOW_TEST_SIGN_IN=true (see playwright.config.ts), exposing
// POST /auth/dev/sign-in: upsert user, mint session JWT, return
// Set-Cookie. This helper drives that endpoint and lets Playwright's
// cookie jar catch the response, so subsequent navigations are
// authenticated end-to-end (no JWT minting in test code).

import type { BrowserContext } from '@playwright/test';

export interface TestUser {
  email: string;
  displayName?: string;
}

export const DEFAULT_TEST_USER: TestUser = {
  email: 'test@example.com',
  displayName: 'Test User',
};

export interface SignedInResponse {
  id: string;
  email: string;
  display_name: string;
  color: string;
}

/**
 * Sign the context in as the given user. Returns the server-issued
 * user record so callers can use the real id / color in assertions.
 */
export async function signIn(
  context: BrowserContext,
  user: TestUser = DEFAULT_TEST_USER,
): Promise<SignedInResponse> {
  const res = await context.request.post('/auth/dev/sign-in', {
    data: { email: user.email, displayName: user.displayName },
  });
  if (!res.ok()) {
    throw new Error(
      `signIn failed: ${res.status()} ${await res.text()}. ` +
        'Is ALLOW_TEST_SIGN_IN=true on the bartleby server?',
    );
  }
  return (await res.json()) as SignedInResponse;
}

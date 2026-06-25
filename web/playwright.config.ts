import { defineConfig, devices } from '@playwright/test';

// Test bartleby server env. The auth helper in tests/helpers/auth.ts
// mints a session JWT signed with this same SESSION_SECRET so tests
// skip OAuth. Allowlist + Google config are placeholders — tests never
// actually hit Google.
const bartlebyServerEnv = {
  PORT: '1234',
  HTTP_PORT: '3001',
  BARTLEBY_BIND_ADDRESS: '127.0.0.1',
  PUBLIC_BASE_URL: 'http://127.0.0.1:5173',
  SESSION_SECRET: 'test-only-session-secret-must-be-at-least-32-chars',
  // Includes a few extra non-signed-in entries so the W-013 mention
  // picker has both "signed-in" (test@example.com via the dev sign-in
  // helper) and "allowlist-only" (alice/bob/charlie) options to
  // display. Q-006: charlie is reserved for tests that need a user
  // GUARANTEED to be allowlist-only (no displayName). alice/bob are
  // signed in by other suites (editor-presence sets a displayName),
  // and that signup persists in the in-memory users table across
  // workers, so a test that asserts "@<email> fallback labeling"
  // cannot trust either of them.
  BARTLEBY_ALLOWED_EMAILS: 'test@example.com,alice@example.com,bob@example.com,charlie@example.com',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  // Mounts POST /auth/dev/sign-in so tests can skip the OAuth dance.
  // NEVER set in production. Also flips the mention-email pipeline to a
  // recording transport (Q-003) so the e2e admin endpoints work.
  ALLOW_TEST_SIGN_IN: 'true',
  // Q-003: collapse the M-005 sliding-window batcher from its 60s
  // production default so the happy-path e2e doesn't have to wait a
  // minute (or poll a flush endpoint) for the email to land. The
  // production code path is unchanged — this is only an override.
  MENTION_BATCH_WINDOW_MS: '100',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile projects only run the mobile-* test files — the editor smoke
    // test requires a visible ProseMirror surface that doesn't exist on
    // phones (the editor is hidden via CSS below 768px).
    // Both projects use chromium as the engine (overriding iPhone 13's
    // webkit default) so we don't need a separate webkit browser install;
    // we still get correct viewport/UA/touch emulation for the form factor.
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
      testMatch: '**/mobile-*.test.ts',
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/mobile-*.test.ts',
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        BARTLEBY_HTTP_PORT: bartlebyServerEnv.HTTP_PORT,
        // SvelteKit's hooks.server.ts verifies the session JWT locally,
        // so it needs the same SESSION_SECRET the bartleby server (and
        // the test auth helper) use.
        SESSION_SECRET: bartlebyServerEnv.SESSION_SECRET,
      },
    },
    {
      command: 'npm run start:test --prefix ../server',
      port: 1234,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: bartlebyServerEnv,
    },
  ],
});

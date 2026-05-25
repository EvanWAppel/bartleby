import { defineConfig, devices } from '@playwright/test';

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
    },
    {
      command: 'npm run dev --prefix ../server',
      port: 1234,
      env: { PORT: '1234' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

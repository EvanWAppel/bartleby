// W-001/W-002: routing + sign-in.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';

test.describe('unauthed', () => {
  test('GET / redirects to /login with the original path in ?next', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    await expect(page.getByTestId('login')).toBeVisible();
  });

  test('GET /n/something also redirects to /login with ?next preserved', async ({ page }) => {
    await page.goto('/n/abc-123');
    await expect(page).toHaveURL(/\/login\?next=%2Fn%2Fabc-123$/);
  });

  test('/login renders with a sign-in link to /auth/google/start', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login')).toBeVisible();
    const link = page.getByTestId('signin-link');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/auth\/google\/start\?next=/);
  });
});

test.describe('authed', () => {
  test('/login bounces to / when already signed in', async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await context.close();
  });

  test('/login?next=/n/abc bounces back to /n/abc', async ({ browser }) => {
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();
    await page.goto('/login?next=%2Fn%2Fabc');
    await expect(page).toHaveURL(/\/n\/abc$/);
    await context.close();
  });
});

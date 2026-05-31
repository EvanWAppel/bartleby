// W-003 + W-028: app shell renders for authed users; root route shows
// the empty state until a note is opened.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';

test('signed-in user sees the shell + empty state on /', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('main-pane')).toBeVisible();
  await expect(page.getByTestId('right-pane')).toBeVisible();
  await expect(page.getByTestId('empty-state')).toBeVisible();

  // Footer shows the signed-in user's display name.
  await expect(page.getByTestId('signed-in-user')).toContainText('Test User');
  await context.close();
});

test('signed-in user navigating to /n/[id] sees the editor', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  const id = `w-pr1-${Date.now()}`;
  await page.goto(`/n/${id}`);

  await expect(page.getByTestId('app-shell')).toBeVisible();
  // Editor mounts inside the main pane; scope to the editor's
  // ProseMirror surface specifically (mobile reader also renders one).
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await context.close();
});

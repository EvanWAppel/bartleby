// W-003 + W-028: app shell renders for authed users; root route shows
// the empty state until a note is opened.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

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
  const note = await createNote(context, `shell-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  await expect(page.getByTestId('app-shell')).toBeVisible();
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await context.close();
});

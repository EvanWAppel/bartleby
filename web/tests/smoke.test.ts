// V-005 acceptance, updated for W's authenticated routing:
// editor lives at /n/[id] and requires a session cookie.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';

test('editor accepts input and renders it (V-005 acceptance, authed)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();

  // Unique room id per run keeps Hocuspocus state from leaking between runs.
  const id = `v005-${Date.now()}`;
  await page.goto(`/n/${id}`);

  // Mobile reader also mounts a .ProseMirror — scope to the editor.
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.type('hello');

  await expect(editor).toContainText('hello');
  await context.close();
});

// V-005 acceptance, updated for W's authenticated routing:
// editor lives at /n/[id] (with a real notes metadata row) and
// requires a session cookie.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('editor accepts input and renders it (V-005 acceptance, authed)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `v005-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  // Mobile reader also mounts a .ProseMirror — scope to the editor.
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.type('hello');

  await expect(editor).toContainText('hello');
  await context.close();
});

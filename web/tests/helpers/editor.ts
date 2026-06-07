// Shared setup for editor-related Playwright suites (toolbar,
// shortcuts, autocomplete). Each test gets its own browser context +
// sign-in + fresh note, navigates to /n/[id], and waits until the
// EditorView is fully wired up (the toolbar only mounts after the
// async onMount chain — dynamic imports + Yjs init — completes).
//
// `initial` is optionally typed into the editor before the helper
// returns. We round-trip-assert it actually landed in the DOM, which
// prevents flake from tests starting before the EditorView is
// interactive under multi-worker server load.

import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { signIn } from './auth.js';
import { createNote } from './notes.js';

export interface EditorHandle {
  page: Page;
  editor: Locator;
  close: () => Promise<void>;
}

export async function openFreshEditor(
  browser: Browser,
  titlePrefix: string,
  initial?: string,
): Promise<EditorHandle> {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `${titlePrefix}-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await editor.click();
  if (initial !== undefined && initial.length > 0) {
    await page.keyboard.type(initial);
    await expect(editor).toContainText(initial);
  }
  return { page, editor, close: () => context.close() };
}

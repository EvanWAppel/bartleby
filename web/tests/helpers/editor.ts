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
//
// Q-006: we additionally wait for the editor to advertise itself as
// ready (data-editor-ready="true" on the editor wrapper). The editor
// only sets that attribute once BOTH the EditorView is wired up AND
// the Hocuspocus provider has finished its initial sync handshake
// with the server — typing before sync completes can be erased by an
// inbound sync that arrives mid-keystroke, which is the root cause of
// the flaky strike/Mod-Shift-X tests we were seeing.

import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { signIn } from './auth.js';
import { createNote } from './notes.js';

export interface EditorHandle {
  page: Page;
  editor: Locator;
  close: () => Promise<void>;
}

/**
 * Wait until the editor advertises itself as fully ready (Yjs sync
 * complete + view + toolbar mounted). Exported for tests that don't
 * use `openFreshEditor` but still navigate to /n/[id] manually.
 */
export async function waitForEditorReady(page: Page): Promise<void> {
  // 15s upper bound — generous so this never times out on a healthy
  // server; the actual sync usually lands in well under a second.
  await page.locator('[data-testid="editor"][data-editor-ready="true"]').waitFor({
    state: 'attached',
    timeout: 15_000,
  });
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
  await waitForEditorReady(page);
  await editor.click();
  if (initial !== undefined && initial.length > 0) {
    await page.keyboard.type(initial);
    await expect(editor).toContainText(initial);
  }
  return { page, editor, close: () => context.close() };
}

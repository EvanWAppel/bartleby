// W-019: snapshots pane (list + preview + restore) + C-006 restore.
//
// Spec test: "restore replaces document content."
//
// Flow:
//   1. Type "v1" into the editor, save a named snapshot.
//   2. Type "v2" (live doc now diverges from snapshot).
//   3. Click the v1 row → preview shows v1's markdown.
//   4. Click "Restore this snapshot" + confirm.
//   5. Reload the page (so the editor re-reads the persisted Yjs doc
//      via Hocuspocus). The editor now shows v1.
//
// We deliberately reload between restore and the assertion: the
// editor's live Y.Doc is independent of the server's, and the server's
// transaction-on-direct-connection happens via Hocuspocus's storage
// layer. The reload re-creates the HocuspocusProvider which pulls the
// canonical state.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('snapshots pane lists, previews, and restores (W-019 spec test)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `snap-restore-${Date.now()}`);
  const page = await ctx.newPage();
  // Auto-accept the confirm() dialog in onRestore.
  page.on('dialog', (d) => void d.accept());

  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('snapshot v1');
  await expect(editor).toContainText('snapshot v1');

  // Open the History tab and save a named snapshot of the current
  // state ("v1").
  await page.getByTestId('right-pane-tab-history').click();
  await page.getByTestId('snapshots-pane').waitFor({ state: 'visible' });
  await page.getByTestId('snapshots-pane-save-open').click();
  await page.getByTestId('snapshots-pane-save-label').fill('v1');
  await page.getByTestId('snapshots-pane-save-submit').click();

  // The list now has a row for "v1".
  const list = page.getByTestId('snapshots-pane-list');
  await expect(list).toBeVisible();
  await expect(list.getByText('v1')).toBeVisible();

  // Move the live doc forward to "v2". Give the server a moment to
  // persist the WS update before continuing — restore reads from
  // Hocuspocus's loaded doc state.
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('snapshot v2');
  await expect(editor).toContainText('snapshot v2');
  await page.waitForTimeout(800);

  // Click the v1 row → preview surfaces.
  const v1Row = list.locator('li', { hasText: 'v1' });
  await v1Row.locator('button').first().click();
  await expect(page.getByTestId('snapshots-pane-preview')).toBeVisible();
  await expect(page.getByTestId('snapshots-pane-preview-markdown')).toContainText('snapshot v1');

  // Restore. The auto-accept dialog handler approves the confirm().
  await page.getByTestId('snapshots-pane-restore').click();
  // The list refreshes — a pre-restore "auto" row now sits above v1.
  await expect(list.getByText('auto').first()).toBeVisible({ timeout: 5000 });

  // Reload — the HocuspocusProvider re-pulls the canonical state. The
  // editor should now show v1 (no "v2" line).
  await page.reload();
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await expect(editor).toContainText('snapshot v1');
  await expect(editor).not.toContainText('snapshot v2');

  await ctx.close();
});

test('an unmodified note shows the empty state in the History tab (W-019)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `snap-empty-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('right-pane-tab-history').click();
  await expect(page.getByTestId('snapshots-pane-empty')).toBeVisible();
  await ctx.close();
});

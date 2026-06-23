// W-018: selection-driven comment composer + in-body numbered markers.
//
// Spec test: "selection produces anchor; comment renders in pane."
// Plus body markers (deferred from W-017's task line): "Comment markers
// in the body are numbered and clickable."
//
// Flow under test:
//   1. Type some text into the editor.
//   2. Select it. A floating "Comment" toolbar appears near the
//      selection.
//   3. Click the toolbar's button. The toolbar swaps for an inline
//      composer popover that shows the selected text as a quote.
//   4. Type a body, submit. The composer closes.
//   5. The comment appears in the right pane's Comments tab. The
//      created comment has a non-empty anchor JSON.
//   6. A numbered marker appears in the body at the anchored position.
//   7. Clicking the marker switches the right pane to Comments and
//      highlights the corresponding thread.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('selection produces an anchored comment that renders in the pane (W-018 spec test)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `cc-anchor-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('anchor on world');
  await expect(editor).toContainText('anchor on world');

  // Select the trailing word "world" via keyboard. Playwright's
  // `.dblclick()` doesn't reliably trigger ProseMirror's
  // mouse-selection handler under test, so we use End + repeated
  // Shift+ArrowLeft to land a stable PM TextSelection.
  await page.keyboard.press('End');
  for (let i = 0; i < 'world'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }

  // Floating toolbar surfaces near the selection.
  await expect(page.getByTestId('comment-floating-toolbar')).toBeVisible();
  await page.getByTestId('comment-floating-toolbar-button').click();

  // Composer popover shows the quoted text + a body input.
  await expect(page.getByTestId('comment-composer')).toBeVisible();
  await expect(page.getByTestId('comment-composer-quote')).toHaveText('world');
  await page.getByTestId('comment-composer-body').fill('anchored comment body');
  await page.getByTestId('comment-composer-submit').click();
  await expect(page.getByTestId('comment-composer')).toBeHidden();

  // Comment appears in the pane.
  await page.getByTestId('right-pane-tab-comments').click();
  await expect(
    page.getByTestId('comments-pane-list').getByText('anchored comment body'),
  ).toBeVisible();

  // The stored anchor is a non-empty JSON shape (two RelativePositions).
  // Hit the API directly to assert this — the visual pane assertions
  // don't reach into the row.
  const apiRes = await ctx.request.get(`/notes/${note.id}/comments`);
  const body = (await apiRes.json()) as {
    comments: { body: string; anchor: string; original_quote: string }[];
  };
  const ours = body.comments.find((c) => c.body === 'anchored comment body');
  expect(ours).toBeDefined();
  expect(ours?.original_quote).toBe('world');
  expect(ours?.anchor).not.toBe('');
  const parsed = JSON.parse(ours?.anchor ?? '{}') as { from?: unknown; to?: unknown };
  expect(parsed.from).toBeDefined();
  expect(parsed.to).toBeDefined();
  await ctx.close();
});

test('a numbered marker renders in the body and clicking it focuses the thread (W-018 markers)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `cc-marker-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  // Select a fixed-length suffix via End + Shift+ArrowLeft × N — the
  // same selection pattern the W-018 spec test uses successfully.
  // Ctrl+A would produce an AllSelection (doc-level) which the
  // comment-selection plugin rejects; Home + Shift+End is flaky for
  // reasons that look like synthetic-event timing in PM.
  const anchor = 'anchor';
  await page.keyboard.type(`text to ${anchor}`);
  await page.keyboard.press('End');
  for (let i = 0; i < anchor.length; i += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await page.getByTestId('comment-floating-toolbar-button').click();
  await page.getByTestId('comment-composer-body').fill('marker test');
  await page.getByTestId('comment-composer-submit').click();
  await expect(page.getByTestId('comment-composer')).toBeHidden();

  // Body marker: numbered chip rendered just after the anchored text.
  const marker = editor.locator('button[data-comment-marker]').first();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveText('1');

  // Clicking the marker dispatches a focus event the pane listens for;
  // the pane's tab gets activated (the marker click also writes to the
  // localStorage tab key so a future reload would land on Comments).
  await marker.click();
  await expect(page.getByTestId('right-pane-tab-comments')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Threads list shows our comment.
  await expect(page.getByTestId('comments-pane-list').getByText('marker test')).toBeVisible();
  await ctx.close();
});

test('Escape dismisses the composer without posting (W-018)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `cc-escape-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('cancel me');
  await page.keyboard.press('Home');
  for (let i = 0; i < 'cancel'.length; i += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  await page.getByTestId('comment-floating-toolbar-button').click();
  await expect(page.getByTestId('comment-composer')).toBeVisible();
  await page.getByTestId('comment-composer-body').fill('will be discarded');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('comment-composer')).toBeHidden();

  // No comment was stored — the API list is empty.
  const apiRes = await ctx.request.get(`/notes/${note.id}/comments`);
  const body = (await apiRes.json()) as { comments: unknown[] };
  expect(body.comments).toHaveLength(0);
  await ctx.close();
});

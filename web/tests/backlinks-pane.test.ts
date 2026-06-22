// W-016: backlinks pane content.
//
// Spec test: "link from A to B shows A in B's pane".
//
// The full real flow is end-to-end through Yjs + Hocuspocus + S-009:
// type the backlink in A, the onStoreDocument hook serializes the doc
// to markdown, the backlink extractor populates the backlinks table,
// the pane fetches /notes/B/backlinks and renders A. We accept that
// extra latency (Hocuspocus debounces saves; S-009 runs on save) by
// giving the post-insert wait + the pane re-render a generous timeout.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('backlinks pane shows the empty state when nothing links here (W-016)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `bl-empty-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });

  await page.getByTestId('right-pane-tab-backlinks').click();
  await expect(page.getByTestId('backlinks-pane')).toBeVisible();
  await expect(page.getByTestId('backlinks-pane-empty')).toBeVisible();
  await ctx.close();
});

test("link from A to B shows A in B's pane (W-016 spec test)", async ({ browser }) => {
  // Two notes with deterministic, unique titles so the W-012 picker
  // unambiguously surfaces B as a candidate. The picker is the realistic
  // user path; typing `[[title]]` raw would also work via the regex
  // extractor but the picker path doubles as a small W-012 regression.
  const stamp = String(Date.now());
  const ctx = await browser.newContext();
  await signIn(ctx);
  const titleA = `bl-A-${stamp}`;
  const titleB = `bl-B-${stamp}`;
  const a = await createNote(ctx, titleA);
  const b = await createNote(ctx, titleB);

  const page = await ctx.newPage();
  await page.goto(`/n/${a.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  // Type just enough to disambiguate B from A in the picker.
  await page.keyboard.type(`[[bl-B-${stamp}`);
  await page.getByTestId('backlink-picker').waitFor({ state: 'visible' });
  await page.getByTestId('backlink-picker').getByText(titleB).click();
  // Backlink atom must be in the doc before we navigate away.
  await expect(editor.locator('a[data-backlink]')).toHaveText(titleB);

  // Give Hocuspocus + S-009 enough room to debounce-flush the save and
  // populate the backlinks table. The pane fetch + render adds another
  // few hundred ms; we use Playwright's auto-retrying expect with a
  // generous timeout rather than a fixed sleep, so green runs stay
  // fast and only the slow ones eat the full window.
  await page.goto(`/n/${b.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('right-pane-tab-backlinks').click();
  await expect(page.getByTestId('backlinks-pane-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`backlink-source-${a.id}`)).toHaveText(titleA, {
    timeout: 15_000,
  });

  await ctx.close();
});

test('clicking a backlink navigates to the source note (W-016)', async ({ browser }) => {
  // Reuse the same picker flow as the spec test and assert the rendered
  // link is a real navigation target (not a no-op `<button>`).
  const stamp = String(Date.now());
  const ctx = await browser.newContext();
  await signIn(ctx);
  const a = await createNote(ctx, `bl-nav-A-${stamp}`);
  const b = await createNote(ctx, `bl-nav-B-${stamp}`);

  const page = await ctx.newPage();
  await page.goto(`/n/${a.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type(`[[bl-nav-B-${stamp}`);
  await page.getByTestId('backlink-picker').waitFor({ state: 'visible' });
  await page.getByTestId('backlink-picker').getByText(`bl-nav-B-${stamp}`).click();
  await expect(editor.locator('a[data-backlink]')).toHaveText(`bl-nav-B-${stamp}`);

  await page.goto(`/n/${b.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('right-pane-tab-backlinks').click();
  const link = page.getByTestId(`backlink-source-${a.id}`);
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/n/${a.id}$`));

  await ctx.close();
});

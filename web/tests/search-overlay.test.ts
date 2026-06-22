// W-020 search overlay.
//
// Spec test: "query → result → navigate."
//
// The FTS index is populated by the S-009 onStoreDocument hook on
// Yjs save. We type into the editor, wait for the debounce + write,
// then open the search overlay and confirm a click navigates.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('Cmd-K opens the overlay; typing surfaces hits; clicking navigates (W-020 spec test)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const stamp = String(Date.now());
  // Create a target note + type unique content the search will match.
  const note = await createNote(ctx, `search-target-${stamp}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  const needle = `kestrel${stamp}`;
  await page.keyboard.type(`looking for a ${needle} here`);
  // Hocuspocus debounce + S-009 hook → markdown_export → FTS5 trigger
  // chain takes up to a few seconds end-to-end. We poll the /search
  // endpoint directly until it returns a hit before opening the
  // overlay — this isolates the FTS-readiness latency from the
  // overlay's own behavior, which is what the test is actually about.
  await expect
    .poll(
      async () => {
        const res = await ctx.request.get(`/search?q=${needle}`);
        const body = (await res.json()) as { hits: { id: string }[] };
        return body.hits.some((h) => h.id === note.id);
      },
      { timeout: 15_000, intervals: [500, 500, 1_000] },
    )
    .toBe(true);

  // Cmd-K opens the overlay. We need focus outside the editor so the
  // editor's keymap (Mod-K → link popover) doesn't consume the event;
  // click the sidebar's brand area first.
  await page.getByTestId('sidebar').click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('search-overlay')).toBeVisible();

  // Click the input to make sure focus lands there before typing —
  // under heavy parallel load the auto-focus inside openOverlay can
  // race a stray DOM event, and we'd rather make the test deterministic
  // than the focus call.
  const input = page.getByTestId('search-overlay-input');
  await input.click();
  await input.fill(needle);
  const results = page.getByTestId('search-overlay-results');
  await expect(results).toBeVisible({ timeout: 8_000 });
  const row = page.getByTestId(`search-overlay-result-${note.id}`);
  await expect(row).toBeVisible();
  // The snippet contains the highlighted needle.
  await expect(row.locator('mark')).toContainText(needle);

  // Click the row → navigates to /n/[id] and closes the overlay.
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/n/${note.id}$`));
  await expect(page.getByTestId('search-overlay')).toBeHidden();

  await ctx.close();
});

test('Escape closes the overlay (W-020)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
  // Hydration proxy: the SearchOverlay attaches its window keydown
  // listener inside its onMount. On `/` there's no editor-toolbar to
  // pin against; we poll instead by firing Cmd-K and waiting for the
  // overlay to materialize, retrying on a 200ms cadence.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('ControlOrMeta+k');
        return await page.getByTestId('search-overlay').isVisible();
      },
      { timeout: 8_000, intervals: [200, 200, 400] },
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('search-overlay')).toBeHidden();
  await ctx.close();
});

test('an empty query shows the prompt; an unmatched query shows "no results" (W-020)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
  // Hydration proxy: the SearchOverlay attaches its window keydown
  // listener inside its onMount. On `/` there's no editor-toolbar to
  // pin against; we poll instead by firing Cmd-K and waiting for the
  // overlay to materialize, retrying on a 200ms cadence.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('ControlOrMeta+k');
        return await page.getByTestId('search-overlay').isVisible();
      },
      { timeout: 8_000, intervals: [200, 200, 400] },
    )
    .toBe(true);
  await expect(page.getByTestId('search-overlay-empty')).toBeVisible();
  await page.getByTestId('search-overlay-input').click();
  await page.getByTestId('search-overlay-input').fill(`zzzz-no-such-note-${Date.now()}-qqq`);
  await expect(page.getByTestId('search-overlay-no-results')).toBeVisible({ timeout: 8_000 });
  await ctx.close();
});

test('Cmd-K inside the editor does NOT open the search overlay (W-020 + W-009 coexist)', async ({
  browser,
}) => {
  // The editor's Mod-K opens the link popover (W-009). The overlay's
  // window listener checks event.defaultPrevented and skips when PM
  // already handled the key — so search stays closed even though
  // focus is in the doc.
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `coexist-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.click();
  // Type + select-all so the link popover has a selection to attach
  // the link to (Mod-K on an empty selection is a W-009 no-op). Ctrl+A
  // is more reliable than shift-arrow under parallel-load test runs —
  // PM doesn't always pick up a clean selection from synthetic
  // ArrowRight events when the system is busy.
  await page.keyboard.type('linkable');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+k');
  // The editor's link popover opens; the search overlay does NOT.
  await expect(page.getByTestId('link-popover')).toBeVisible();
  await expect(page.getByTestId('search-overlay')).toHaveCount(0);
  await ctx.close();
});

// W-007: tag chip editor. Add via input + Enter, remove via × on chip.
// Commits via /api/notes/[id]/retag -> bartleby PATCH /notes/:id with
// the full new tags list -> 303 back to /n/[id] so the page reloads
// with the updated chips.
//
// Mirrors W-006's form-submit pattern (see title-editor.test.ts for
// the rationale around Svelte 5 event delegation vs. native form
// submits in the Playwright runtime).

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

async function setInitialTags(
  context: import('@playwright/test').BrowserContext,
  id: string,
  tags: string[],
): Promise<void> {
  const res = await context.request.patch(`/notes/${id}`, { data: { tags } });
  if (!res.ok()) {
    throw new Error(`setInitialTags failed: ${res.status()} ${await res.text()}`);
  }
}

test('initial tags from server.load render as chips', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `tags-initial-${Date.now()}`);
  await setInitialTags(context, note.id, ['alpha', 'beta']);

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  await expect(page.getByTestId('tag-chip').filter({ hasText: 'alpha' })).toBeVisible();
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'beta' })).toBeVisible();
  await context.close();
});

test('add tag via Enter persists across reload', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `tags-add-${Date.now()}`);
  await setInitialTags(context, note.id, ['alpha']);

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const input = page.getByTestId('tag-add-input');
  await input.click();
  await input.fill('gamma');
  // Native form submit on Enter -> /api/notes/[id]/retag -> PATCH ->
  // 303 redirect back to /n/[id] -> page reloads with the new chip.
  await Promise.all([page.waitForLoadState('load'), input.press('Enter')]);

  await expect(page.getByTestId('tag-chip').filter({ hasText: 'gamma' })).toBeVisible();
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'alpha' })).toBeVisible();

  // Survives an explicit reload — proves persistence.
  await page.reload();
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'gamma' })).toBeVisible();
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'alpha' })).toBeVisible();
  await context.close();
});

test('remove tag via × persists across reload', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `tags-remove-${Date.now()}`);
  await setInitialTags(context, note.id, ['keep', 'drop']);

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const dropChip = page.getByTestId('tag-chip').filter({ hasText: 'drop' });
  await expect(dropChip).toBeVisible();

  await Promise.all([page.waitForLoadState('load'), dropChip.getByTestId('tag-remove').click()]);

  await expect(page.getByTestId('tag-chip').filter({ hasText: 'drop' })).toHaveCount(0);
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'keep' })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'drop' })).toHaveCount(0);
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'keep' })).toBeVisible();
  await context.close();
});

test('empty/whitespace input + Enter is a no-op', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `tags-empty-${Date.now()}`);
  await setInitialTags(context, note.id, ['only']);

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const input = page.getByTestId('tag-add-input');
  await input.click();
  await input.fill('   ');
  await Promise.all([page.waitForLoadState('load'), input.press('Enter')]);

  // The retag endpoint drops empties+whitespace, so the existing
  // tag set is unchanged and no phantom chip appears.
  await expect(page.getByTestId('tag-chip')).toHaveCount(1);
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'only' })).toBeVisible();
  await context.close();
});

test('tags from PATCH-via-API reflect on next page load', async ({ browser }) => {
  // Independent of the form path: prove the GET-load + PATCH endpoints
  // agree on the canonical tag set so other paths (TUI, second tab)
  // see retags immediately.
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `tags-api-${Date.now()}`);

  const res = await context.request.patch(`/notes/${note.id}`, {
    data: { tags: ['api-set-one', 'api-set-two'] },
  });
  expect(res.ok()).toBe(true);

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'api-set-one' })).toBeVisible();
  await expect(page.getByTestId('tag-chip').filter({ hasText: 'api-set-two' })).toBeVisible();
  await context.close();
});

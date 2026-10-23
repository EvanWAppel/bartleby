// W-006: title-in-place editor. Renames commit via form submit
// (Enter triggers native submit -> /api/notes/[id]/rename -> bartleby
// PATCH /notes/:id -> 303 back to /n/[id] with the new title).
//
// Why form-based: Svelte 5 delegates input/blur/click event handlers
// to document-level listeners, and Playwright's programmatic key/blur
// events didn't reach those listeners reliably in this combo. Native
// form submits sidestep the delegation entirely.
//
// W-029: blur-to-save. TitleEditor attaches a native `blur` listener
// via addEventListener (bypassing Svelte's handler props) that calls
// form.requestSubmit() when the draft differs from the server title,
// so blur goes through the same form-submit path as Enter. The input
// carries `data-blur-ready="true"` once that listener exists; tests
// gate on it so a blur never fires before hydration.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('initial title from server.load shows in the input', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `title-initial-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  await expect(page.getByTestId('title-input')).toHaveValue(note.title);
  await context.close();
});

test('rename via Enter persists across reload', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `title-enter-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const input = page.getByTestId('title-input');
  await expect(input).toHaveValue(note.title);

  await input.click();
  await input.fill('Renamed via Enter');
  // Native form submit on Enter -> server PATCH -> 303 redirect back
  // to /n/[id] -> page reloads with the new title.
  await Promise.all([page.waitForLoadState('load'), input.press('Enter')]);

  await expect(page.getByTestId('title-input')).toHaveValue('Renamed via Enter');

  // Survives an explicit reload too (proves it persisted on the server).
  await page.reload();
  await expect(page.getByTestId('title-input')).toHaveValue('Renamed via Enter');
  await context.close();
});

test('empty submit is a no-op (server returns original)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const original = `title-empty-${Date.now()}`;
  const note = await createNote(context, original);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const input = page.getByTestId('title-input');
  await input.click();
  await input.fill('   ');
  await Promise.all([page.waitForLoadState('load'), input.press('Enter')]);

  // Server's /api/notes/[id]/rename treats whitespace-only as no-op;
  // we're bounced back to /n/[id] and the original title still stands.
  await expect(page.getByTestId('title-input')).toHaveValue(original);
  await context.close();
});

test('title from PATCH-via-API reflects on next page load', async ({ browser }) => {
  // Independent of the form path: prove the GET-load + PATCH endpoints
  // agree on the canonical title so other paths (TUI, second browser
  // tab, etc.) see renames immediately.
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `title-api-${Date.now()}`);

  const res = await context.request.patch(`/notes/${note.id}`, {
    data: { title: 'Renamed via API' },
  });
  expect(res.ok()).toBe(true);

  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  await expect(page.getByTestId('title-input')).toHaveValue('Renamed via API');
  await context.close();
});

test('W-029: rename via blur persists across reload', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `title-blur-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const input = page.getByTestId('title-input');
  await expect(input).toHaveValue(note.title);
  // Cold vite-dev hydration can exceed the 5s default.
  await expect(input).toHaveAttribute('data-blur-ready', 'true', { timeout: 30_000 });

  await input.click();
  await input.fill('Renamed via blur');
  // Real focus move (click elsewhere on the page), not a synthetic
  // dispatchEvent — this is the user gesture blur-to-save exists for.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/notes/${note.id}/rename`) && r.request().method() === 'POST',
    ),
    page.getByTestId('tag-add-input').click(),
  ]);

  // Persisted server-side: the canonical GET reflects the new title.
  await expect
    .poll(async () => {
      const res = await context.request.get(`/notes/${note.id}`);
      return ((await res.json()) as { title: string }).title;
    })
    .toBe('Renamed via blur');

  await page.reload();
  await expect(page.getByTestId('title-input')).toHaveValue('Renamed via blur');
  await context.close();
});

test('W-029: blur without changes does not submit', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `title-blur-noop-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);

  const input = page.getByTestId('title-input');
  // Cold vite-dev hydration can exceed the 5s default.
  await expect(input).toHaveAttribute('data-blur-ready', 'true', { timeout: 30_000 });

  let renamePosts = 0;
  page.on('request', (req) => {
    if (req.url().includes('/rename') && req.method() === 'POST') renamePosts += 1;
  });

  await input.click();
  await page.getByTestId('tag-add-input').click();
  // Give any (wrong) submit a chance to fire before asserting none did.
  await page.waitForTimeout(500);
  expect(renamePosts).toBe(0);
  await expect(input).toHaveValue(note.title);
  await context.close();
});

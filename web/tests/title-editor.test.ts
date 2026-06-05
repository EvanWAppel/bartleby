// W-006: title-in-place editor. Renames commit via form submit
// (Enter triggers native submit -> /api/notes/[id]/rename -> bartleby
// PATCH /notes/:id -> 303 back to /n/[id] with the new title).
//
// Why form-based: Svelte 5 delegates input/blur/click event handlers
// to document-level listeners, and Playwright's programmatic key/blur
// events didn't reach those listeners reliably in this combo. Native
// form submits sidestep the delegation entirely.
//
// Blur-to-save (also part of W-006's spec) is intentionally deferred
// for the same reason — Enter satisfies the core "in-place rename"
// use case for v1.

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

// W-004: sidebar notes list (live-polled) + new-note button.
// W-005: clicking "+ new" creates a note via POST /notes and
// navigates to /n/[new-id].

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('sidebar lists notes the signed-in user can see', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const a = await createNote(context, `sidebar-A-${Date.now()}`);
  const b = await createNote(context, `sidebar-B-${Date.now()}`);
  const page = await context.newPage();
  await page.goto('/');

  // Both notes show up (poll completes within the default expect timeout).
  await expect(page.getByTestId('notes-list-item').filter({ hasText: a.title })).toBeVisible();
  await expect(page.getByTestId('notes-list-item').filter({ hasText: b.title })).toBeVisible();
  await context.close();
});

test('sidebar picks up notes created externally within ~1s (W-004 live spec)', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  await page.goto('/');

  // Confirm we're past the initial load before adding the external note.
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const externallyCreated = await createNote(context, `live-create-${Date.now()}`);

  // Polling interval is 1s; allow up to 3s for the next poll + render.
  await expect(
    page.getByTestId('notes-list-item').filter({ hasText: externallyCreated.title }),
  ).toBeVisible({ timeout: 3000 });
  await context.close();
});

test('clicking "+ new" creates a note and navigates to /n/[id]', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByTestId('empty-state')).toBeVisible();

  const newBtn = page.getByTestId('new-note-button');
  await expect(newBtn).toBeVisible();
  // The button submits a form (action="/api/notes/new"). Form submits
  // are not subject to the delegated-click quirk that made plain
  // <button onclick> fragile in this test setup.
  await newBtn.click();

  // The created note's id lands in the URL.
  await page.waitForURL(/\/n\/[0-9a-f-]{36}$/, { timeout: 5000 });

  // Editor mounts.
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });

  // Default title "Untitled" populated the title editor.
  await expect(page.getByTestId('title-input')).toHaveValue('Untitled');
  await context.close();
});

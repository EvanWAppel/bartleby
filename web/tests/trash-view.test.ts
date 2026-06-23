// W-022 + W-024: trash view (Restore / Delete forever) + delete-
// confirmation modal from the note view and the sidebar list.
//
// Spec test pair: "restore round-trip with W-024" — soft-delete via
// the W-024 confirmation modal → row shows up in /trash → restore →
// it's back in the live list.

import { test, expect, type BrowserContext } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

async function softDeleteApi(ctx: BrowserContext, id: string): Promise<void> {
  const res = await ctx.request.delete(`/notes/${id}`);
  if (!res.ok()) throw new Error(`soft-delete failed: ${res.status()}`);
}

test('restore round-trip with W-024: soft-delete from note view → /trash → restore', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `trash-rt-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });

  // Open the W-024 confirmation modal from the note view, confirm.
  await page.getByTestId('note-view-trash').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-confirm').click();

  // Successful delete navigates to /trash.
  await expect(page).toHaveURL(/\/trash$/);
  // The row is on the page (server load() pulled the freshly-trashed note).
  await expect(page.getByTestId(`trash-row-${note.id}`)).toBeVisible();
  await expect(page.getByTestId(`trash-row-title-${note.id}`)).toHaveText(note.title);

  // Restore. The row optimistically drops off the page; invalidateAll
  // re-fetches as the canonical confirmation.
  await page.getByTestId(`trash-row-restore-${note.id}`).click();
  await expect(page.getByTestId(`trash-row-${note.id}`)).toHaveCount(0);

  // Live list: navigate back to / and the restored note is in the
  // sidebar within the 1s NotesStore poll window.
  await page.goto('/');
  await expect(page.getByText(note.title)).toBeVisible({ timeout: 5_000 });

  await ctx.close();
});

test('confirm-dialog cancel does NOT delete (W-024)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `trash-cancel-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('note-view-trash').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  // Still on the note page; note is NOT in trash.
  await expect(page).toHaveURL(new RegExp(`/n/${note.id}$`));
  const trash = await ctx.request.get('/notes/trash');
  const body = (await trash.json()) as { notes: { id: string }[] };
  expect(body.notes.find((n) => n.id === note.id)).toBeUndefined();

  await ctx.close();
});

test('sidebar row trash button opens the modal and soft-deletes (W-024)', async ({ browser }) => {
  // Per-row trash affordance in the sidebar — same modal flow as the
  // note-view button.
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `trash-sidebar-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ state: 'visible' });
  await expect(page.getByText(note.title)).toBeVisible({ timeout: 5_000 });

  await page.getByTestId(`sidebar-row-trash-${note.id}`).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-confirm').click();

  // Row vanishes from the sidebar on the next poll.
  await expect(page.getByText(note.title)).toHaveCount(0, { timeout: 5_000 });
  // And shows up in trash.
  await page.goto('/trash');
  await expect(page.getByTestId(`trash-row-${note.id}`)).toBeVisible();

  await ctx.close();
});

test('delete forever hard-deletes from /trash (W-022)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `trash-forever-${Date.now()}`);
  // Soft-delete via the API directly so the test focuses on the
  // hard-delete UX rather than re-exercising the W-024 modal.
  await softDeleteApi(ctx, note.id);
  const page = await ctx.newPage();
  await page.goto('/trash');
  await expect(page.getByTestId(`trash-row-${note.id}`)).toBeVisible();

  // /trash is SSR-rendered, so the button exists in DOM before
  // hydration attaches its onclick handler. Wait for hydration via
  // load-state, then click. Re-clicking the same button after the
  // modal opens would route through the backdrop close, so we only
  // want one click.
  await page.waitForLoadState('networkidle');
  await page.getByTestId(`trash-row-delete-forever-${note.id}`).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-dialog-confirm')).toContainText('Delete forever');
  await page.getByTestId('confirm-dialog-confirm').click();

  // Row gone from /trash (optimistic prune + invalidate refetch).
  await expect(page.getByTestId(`trash-row-${note.id}`)).toHaveCount(0);

  // Server confirms the row is actually deleted (not just hidden).
  const trash = await ctx.request.get('/notes/trash');
  const body = (await trash.json()) as { notes: { id: string }[] };
  expect(body.notes.find((n) => n.id === note.id)).toBeUndefined();
  // And the canonical fetch by id 404s.
  const direct = await ctx.request.get(`/notes/${note.id}`);
  expect(direct.status()).toBe(404);

  await ctx.close();
});

test('Esc dismisses the confirm dialog (W-024)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `trash-esc-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('note-view-trash').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/n/${note.id}$`));

  await ctx.close();
});

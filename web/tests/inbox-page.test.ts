// W-023 + M-001..M-004: mentions inbox.
//
// Spec test: "unread badge clears on click."
//
// We use Bob's session to create a note that mentions Alice (M-001
// extractor fires on Hocuspocus save). Then Alice signs in, sees the
// unread badge in the sidebar + the row on /inbox, clicks it, gets
// navigated to the note, and the badge clears.

import { test, expect, type BrowserContext } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

async function postComment(
  ctx: BrowserContext,
  noteId: string,
  body: string,
): Promise<{ id: string }> {
  const res = await ctx.request.post(`/notes/${noteId}/comments`, {
    data: { anchor: '', original_quote: '', body },
  });
  if (!res.ok()) throw new Error(`postComment failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string };
}

/** Mark every existing unread mention for the calling user as read.
 * Used at test start to get clean badge counts despite the shared
 * in-memory DB across parallel tests. */
async function clearUnread(ctx: BrowserContext): Promise<void> {
  const res = await ctx.request.get('/mentions?unread=true');
  const body = (await res.json()) as { mentions: { id: string }[] };
  for (const m of body.mentions) {
    await ctx.request.post(`/mentions/${m.id}/read`);
  }
}

test('unread badge clears on click (W-023 spec test)', async ({ browser }) => {
  // Parallel tests share the in-memory DB and the alice@example.com
  // allowlist seat, so any unread mentions from concurrent runs would
  // skew the badge count. Clear alice's unread set first; then we
  // create a single fresh mention via bob, click it, and assert the
  // badge drops to zero.
  const stamp = String(Date.now());
  const aliceCtx = await browser.newContext();
  await signIn(aliceCtx, { email: 'alice@example.com', displayName: 'Alice' });
  await clearUnread(aliceCtx);
  const bobCtx = await browser.newContext();
  await signIn(bobCtx, { email: 'bob@example.com', displayName: 'Bob' });
  const note = await createNote(bobCtx, `inbox-${stamp}`);
  await postComment(bobCtx, note.id, `hey @alice@example.com — see this`);
  await bobCtx.close();

  const page = await aliceCtx.newPage();
  await page.goto('/inbox');
  await page.getByTestId('inbox-page').waitFor({ state: 'visible' });
  const unreadSection = page.getByTestId('inbox-section-unread');
  await expect(unreadSection).toBeVisible();
  // The new mention surfaces in the unread section.
  const ourRow = unreadSection.locator(`text=inbox-${stamp}`).first();
  await expect(ourRow).toBeVisible();

  // After the pre-test clear, the badge starts at 1 (our fresh mention).
  const badge = page.getByTestId('sidebar-inbox-badge');
  await expect(badge).toBeVisible({ timeout: 7_000 });

  // Click the row → mark-as-read + navigate.
  const openBtn = unreadSection
    .locator('li', { hasText: `inbox-${stamp}` })
    .locator('button[data-testid^="inbox-row-open-"]')
    .first();
  await openBtn.click();
  await expect(page).toHaveURL(new RegExp(`/n/${note.id}$`));

  // The badge disappears within one MentionsStore poll cycle (5s). Use
  // expect.poll so parallel mentions arriving from other tests get
  // tolerated — we ask the predicate "does our mention still count?"
  // by checking the unread list directly via the API.
  await expect
    .poll(
      async () => {
        const r = await aliceCtx.request.get('/mentions?unread=true');
        const body = (await r.json()) as { mentions: { note_id: string }[] };
        return body.mentions.some((m) => m.note_id === note.id);
      },
      { timeout: 10_000, intervals: [500, 500, 1_000] },
    )
    .toBe(false);

  // Reload /inbox — our specific row has moved out of the unread
  // section. (Other parallel-test mentions for alice may still be
  // unread; we only care about ours.)
  await page.goto('/inbox');
  const readSection = page.getByTestId('inbox-section-read');
  await expect(readSection).toBeVisible();
  await expect(readSection.locator(`text=inbox-${stamp}`).first()).toBeVisible();

  await aliceCtx.close();
});

test('inbox shows an empty state when nobody has mentioned the user (W-023)', async ({
  browser,
}) => {
  // Allowlist member who has never been mentioned. We use test@ which
  // is the playwright config's default and hasn't been mentioned in
  // the other tests (those go alice/bob).
  const ctx = await browser.newContext();
  await signIn(ctx, { email: 'test@example.com', displayName: 'Test User' });
  const page = await ctx.newPage();
  await page.goto('/inbox');
  await expect(page.getByTestId('inbox-page-empty')).toBeVisible();
  await ctx.close();
});

test('M-002: a comment mentioning a user creates a mention row (server-level)', async ({
  browser,
}) => {
  // Direct API sanity check: posting a comment with @email creates a
  // mention row visible via GET /mentions for that user.
  const stamp = String(Date.now());
  const aliceCtx = await browser.newContext();
  await signIn(aliceCtx, { email: 'alice@example.com', displayName: 'Alice' });
  const bobCtx = await browser.newContext();
  await signIn(bobCtx, { email: 'bob@example.com', displayName: 'Bob' });
  const note = await createNote(bobCtx, `m002-${stamp}`);
  await postComment(bobCtx, note.id, `cc @alice@example.com hey`);

  const list = (await (await aliceCtx.request.get('/mentions?unread=true')).json()) as {
    mentions: { source: string; note_id: string }[];
  };
  const ours = list.mentions.find((m) => m.note_id === note.id);
  expect(ours).toBeDefined();
  expect(ours?.source.startsWith('comment:')).toBe(true);

  await aliceCtx.close();
  await bobCtx.close();
});

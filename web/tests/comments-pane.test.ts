// W-017 + C-007: comments pane CRUD.
//
// Spec test: "full CRUD". We cover create, reply, resolve, reopen,
// delete in a single end-to-end flow against the real server. W-018's
// in-body selection composer + numbered markers ship later — this PR
// exercises the pane-side composer ("New comment" button) with an
// empty anchor.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('full CRUD on a comment thread (W-017 / C-007 spec test)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `cm-crud-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('right-pane-tab-comments').click();
  await page.getByTestId('comments-pane').waitFor({ state: 'visible' });
  await expect(page.getByTestId('comments-pane-empty')).toBeVisible();

  // CREATE: type a top-level comment and submit.
  await page.getByTestId('comments-pane-new-body').fill('first comment');
  await page.getByTestId('comments-pane-new-submit').click();
  const list = page.getByTestId('comments-pane-list');
  await expect(list).toBeVisible();
  await expect(list.getByText('first comment')).toBeVisible();
  // After submit the composer body is cleared so a second comment can
  // be typed without manual clearing.
  await expect(page.getByTestId('comments-pane-new-body')).toHaveValue('');

  // REPLY: open the reply composer for the thread we just created, post.
  const threadCard = list.locator('[data-testid^="comments-thread-"]').first();
  const threadId = await threadCard.evaluate((el) => {
    const id = el.getAttribute('data-testid');
    return id?.replace('comments-thread-', '') ?? '';
  });
  expect(threadId).not.toBe('');
  await page.getByTestId(`comments-thread-reply-open-${threadId}`).click();
  await page.getByTestId(`comments-thread-reply-body-${threadId}`).fill('reply text');
  await page.getByTestId(`comments-thread-reply-submit-${threadId}`).click();
  await expect(threadCard.getByText('reply text')).toBeVisible();

  // RESOLVE: clicking Resolve adds the resolved badge if includeResolved
  // is on; otherwise the thread drops out of the visible list.
  await page.getByTestId(`comments-thread-resolve-${threadId}`).click();
  await expect(page.getByTestId('comments-pane-empty')).toBeVisible();

  // REOPEN via include-resolved toggle: flip the filter so the resolved
  // thread is visible again, then reopen and confirm the badge is gone.
  await page.getByTestId('comments-pane-include-resolved').check();
  await expect(page.getByTestId(`comments-thread-${threadId}`)).toBeVisible();
  await expect(page.getByTestId(`comments-thread-resolved-${threadId}`)).toBeVisible();
  await page.getByTestId(`comments-thread-resolve-${threadId}`).click();
  await expect(page.getByTestId(`comments-thread-resolved-${threadId}`)).toHaveCount(0);

  // DELETE: thread row is gone after delete; cascade removes the reply
  // server-side, and the local prune mirrors that.
  await page.getByTestId(`comments-thread-delete-${threadId}`).click();
  await expect(page.getByTestId(`comments-thread-${threadId}`)).toHaveCount(0);
  await page.getByTestId('comments-pane-include-resolved').uncheck();
  await expect(page.getByTestId('comments-pane-empty')).toBeVisible();

  await ctx.close();
});

test('comments persist across reload (W-017)', async ({ browser }) => {
  // Without this the pane could be passing CRUD only because of optimistic
  // local mutation — the reload-survives assertion proves the server
  // actually stored the row.
  const ctx = await browser.newContext();
  await signIn(ctx);
  const note = await createNote(ctx, `cm-persist-${Date.now()}`);
  const page = await ctx.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('right-pane-tab-comments').click();
  await page.getByTestId('comments-pane-new-body').fill('survives reload');
  await page.getByTestId('comments-pane-new-submit').click();
  await expect(page.getByTestId('comments-pane-list').getByText('survives reload')).toBeVisible();

  await page.reload();
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  // The W-015 right-pane tab persistence makes the Comments tab sticky,
  // so the pane should re-render with the saved comment after reload.
  await page.getByTestId('right-pane-tab-comments').click();
  await expect(page.getByTestId('comments-pane-list').getByText('survives reload')).toBeVisible();
  await ctx.close();
});

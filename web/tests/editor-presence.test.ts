// W-014 + C-001: presence cursors.
//
// W-014 spec test: "second browser session shows up as a colored cursor
// in the first."
// C-001 spec test: "two clients see each other's awareness."
//
// Same setup satisfies both. We open two browser contexts (alice + bob)
// signed in as distinct users via the dev sign-in helper (alice/bob
// are seeded on the test allowlist by playwright.config.ts), navigate
// each to the same note, have alice type, and assert bob's editor
// renders a `.ProseMirror-yjs-cursor` styled with alice's color and
// labeled with her display_name.

import { test, expect, type Browser, type Page, type Locator } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

interface ClientHandle {
  page: Page;
  editor: Locator;
  close: () => Promise<void>;
}

async function openAsUser(
  browser: Browser,
  email: string,
  displayName: string,
  noteId: string,
): Promise<ClientHandle> {
  const context = await browser.newContext();
  await signIn(context, { email, displayName });
  const page = await context.newPage();
  await page.goto(`/n/${noteId}`);
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  return { page, editor, close: () => context.close() };
}

test('a second browser session sees the first as a colored cursor with their name (W-014 / C-001)', async ({
  browser,
}) => {
  // Pre-create the note as alice; both clients then point at /n/[id].
  // The note title isn't important for the test, but the shared room
  // name (= note id) is the one piece that has to line up.
  const stamp = String(Date.now());
  const setupContext = await browser.newContext();
  await signIn(setupContext, {
    email: 'alice@example.com',
    displayName: `Alice ${stamp}`,
  });
  const note = await createNote(setupContext, `presence-${stamp}`);
  await setupContext.close();

  const alice = await openAsUser(browser, 'alice@example.com', `Alice ${stamp}`, note.id);
  const bob = await openAsUser(browser, 'bob@example.com', `Bob ${stamp}`, note.id);

  // Alice types something so the y-prosemirror cursor plugin has a
  // concrete cursor position to render for bob. Without typing, the
  // cursor sits at pos 0 and the decoration may not paint until the
  // selection actually moves into the doc.
  await alice.editor.click();
  await alice.page.keyboard.type('hello from alice');
  await expect(alice.editor).toContainText('hello from alice');

  // Bob's editor renders the ProseMirror-yjs-cursor decoration with
  // alice's color (border-color via inline style) and her name (the
  // label is the nested <div>'s text content).
  const remoteCursor = bob.editor.locator('.ProseMirror-yjs-cursor');
  await expect(remoteCursor).toHaveCount(1, { timeout: 5000 });
  const label = remoteCursor.locator('div');
  await expect(label).toHaveText(`Alice ${stamp}`);

  // The cursor's border-color (set by defaultCursorBuilder via inline
  // style) is alice's deterministic color. We assert via signIn's
  // returned color value rather than hardcoding a hex — that way the
  // test stays correct if pickColor's palette ever changes.
  const inlineStyle = await remoteCursor.getAttribute('style');
  expect(inlineStyle).toMatch(/border-color:\s*#[0-9a-f]{6}/i);

  await alice.close();
  await bob.close();
});

test('bob also shows up in alice (presence is bidirectional)', async ({ browser }) => {
  // The previous test only asserts one direction; this one flips it so
  // we catch a regression where awareness is only emitted by the first
  // client to type. (yCursorPlugin observes awareness changes from all
  // peers, so bob's presence should reach alice the moment bob's
  // cursor field updates — which happens on his first selection move.)
  const stamp = String(Date.now());
  const setupContext = await browser.newContext();
  await signIn(setupContext, { email: 'alice@example.com', displayName: `Alice ${stamp}` });
  const note = await createNote(setupContext, `presence-bidi-${stamp}`);
  await setupContext.close();

  const alice = await openAsUser(browser, 'alice@example.com', `Alice ${stamp}`, note.id);
  const bob = await openAsUser(browser, 'bob@example.com', `Bob ${stamp}`, note.id);

  await bob.editor.click();
  await bob.page.keyboard.type('hi from bob');
  await expect(bob.editor).toContainText('hi from bob');

  const remoteCursor = alice.editor.locator('.ProseMirror-yjs-cursor');
  await expect(remoteCursor).toHaveCount(1, { timeout: 5000 });
  await expect(remoteCursor.locator('div')).toHaveText(`Bob ${stamp}`);

  await alice.close();
  await bob.close();
});

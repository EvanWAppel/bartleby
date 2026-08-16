import { expect, test } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { waitForEditorReady } from './helpers/editor.js';
import { createNote } from './helpers/notes.js';

test('an edit survives an immediate page reload', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `persistence-${Date.now()}`);
  const page = await context.newPage();
  let dropClientMessages = false;

  await page.routeWebSocket('/collaboration', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (!dropClientMessages) server.send(message);
    });
  });

  await page.goto(`/n/${note.id}`);
  await waitForEditorReady(page);

  const editor = page.getByTestId('editor').locator('.ProseMirror');
  const text = `reload-safe-${Date.now()}`;
  // Model an edit that did not reach Railway before the old page closed.
  // The next connection is allowed through and must replay the local update.
  dropClientMessages = true;
  await editor.click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
  await page.waitForTimeout(50);
  dropClientMessages = false;

  await page.reload();
  await waitForEditorReady(page);
  await expect(page.getByTestId('editor').locator('.ProseMirror')).toContainText(text);

  await context.close();
});

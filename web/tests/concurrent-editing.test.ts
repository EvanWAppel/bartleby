// Q-001: two browser sessions on the same note, simultaneous typing,
// no data loss.
//
// We open two independent BrowserContexts (separate cookie jars,
// separate storage) and sign each in as the same default test user
// — the spec's "two browser sessions" reading. (See editor-presence
// for the two-distinct-users variant.) Both contexts navigate to
// /n/[id] for the same freshly-created note, so they bind to the
// same Hocuspocus room `note:<id>` (Editor.svelte passes `room={data.id}`
// straight through to HocuspocusProvider).
//
// Each context types a distinct marker phrase. We deliberately seat
// the carets at opposite ends of the document (start vs end) so the
// edits don't conflict at the same position, and drive `keyboard.type`
// in parallel via Promise.all so the keystrokes interleave at the
// y-prosemirror level. "No data loss" = every character either side
// typed is present in the final converged document.
//
// Yjs settles asynchronously over the WebSocket; we use expect.poll
// with a generous timeout so the test isn't flaky under CI load.

import { test, expect, type Browser, type Page, type Locator } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

interface ClientHandle {
  page: Page;
  editor: Locator;
  close: () => Promise<void>;
}

async function openClient(browser: Browser, noteId: string): Promise<ClientHandle> {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  await page.goto(`/n/${noteId}`);
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  // editor-toolbar mounts after the async onMount (dynamic imports +
  // Yjs init); waiting on it is the conventional "EditorView is wired
  // up" signal in this codebase.
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  return { page, editor, close: () => context.close() };
}

// Read the editor's text content while excluding y-prosemirror's
// awareness decorations (`.ProseMirror-yjs-cursor` / `…-selection`).
// Those decorations show the *other* peer's name and would otherwise
// make the two clients' innerText disagree even when the underlying
// doc is identical. We strip them DOM-side, then join paragraphs
// with a newline to match what the user would perceive as the doc
// text.
async function readEditorText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="editor"] .ProseMirror');
    if (!editor) return '';
    // Clone, drop awareness decorations, read textContent.
    const clone = editor.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('.ProseMirror-yjs-cursor, .ProseMirror-yjs-selection')
      .forEach((n) => n.remove());
    // Join block children with '\n' so adjacent paragraphs don't
    // glue together into one run of text.
    const parts: string[] = [];
    for (const child of Array.from(clone.children)) {
      parts.push((child as HTMLElement).textContent ?? '');
    }
    return parts.join('\n');
  });
}

test('two browser sessions typing simultaneously converge with no data loss (Q-001)', async ({
  browser,
}) => {
  // Pre-create the note via an ephemeral setup context so neither
  // editor client is privileged with "first to open the room" state.
  const setupContext = await browser.newContext();
  await signIn(setupContext);
  const note = await createNote(setupContext, `q001-${Date.now()}`);
  await setupContext.close();

  const clientA = await openClient(browser, note.id);
  const clientB = await openClient(browser, note.id);

  const phraseA = 'Hello from A ';
  const phraseB = 'Hello from B ';

  // Place caret in each editor. We don't care exactly where — the
  // important thing is that A and B move to *different* endpoints so
  // the inserts target non-overlapping positions. Ctrl/Cmd+Home and
  // Ctrl/Cmd+End move the prosemirror selection to doc start/end.
  await clientA.editor.click();
  await clientA.page.keyboard.press('ControlOrMeta+Home');
  await clientB.editor.click();
  await clientB.page.keyboard.press('ControlOrMeta+End');

  // Drive both typings in parallel. Playwright's keyboard.type is
  // async per-char; running both Promise chains concurrently makes
  // the keystrokes interleave from the server's point of view.
  // `delay: 0` is the default; left explicit to make the intent
  // (fire-as-fast-as-possible, maximally racy) obvious.
  await Promise.all([
    clientA.page.keyboard.type(phraseA, { delay: 0 }),
    clientB.page.keyboard.type(phraseB, { delay: 0 }),
  ]);

  // Convergence: both editors must show identical text containing
  // BOTH phrases. We poll on equality + content, with a generous
  // timeout — Yjs is eventually consistent across the websocket,
  // and CI load can stretch the sync window.
  const expectedSubstrings = [phraseA.trim(), phraseB.trim()];

  await expect
    .poll(
      async () => {
        const [textA, textB] = await Promise.all([
          readEditorText(clientA.page),
          readEditorText(clientB.page),
        ]);
        if (textA !== textB) return { converged: false, textA, textB };
        const missing = expectedSubstrings.filter((s) => !textA.includes(s));
        return { converged: missing.length === 0, textA, textB, missing };
      },
      {
        timeout: 10_000,
        message:
          'expected both browser sessions to converge on identical text containing both phrases',
      },
    )
    .toMatchObject({ converged: true });

  // No data loss: every character of phraseA and phraseB is present.
  // The final character count (modulo paragraph-join newlines) is
  // therefore >= the sum of typed characters.
  const finalText = await readEditorText(clientA.page);
  expect(finalText).toContain(phraseA.trim());
  expect(finalText).toContain(phraseB.trim());
  const typedCharCount = phraseA.length + phraseB.length;
  const visibleChars = finalText.replace(/\n/g, '').length;
  expect(visibleChars).toBeGreaterThanOrEqual(typedCharCount - 2); // tolerate trailing-space trim

  await clientA.close();
  await clientB.close();
});

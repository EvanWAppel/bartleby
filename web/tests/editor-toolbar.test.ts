// W-008: editor toolbar — one test per action. Each test creates a
// fresh note, types content into the ProseMirror editor, applies a
// toolbar action, and asserts the resulting DOM contains the right
// node or mark.
//
// Marks (bold/italic/strike/link) require a non-empty selection; the
// tests use `Meta+A` (Mac) / `Control+A` (others) via Playwright's
// `ControlOrMeta` modifier alias. Block-type actions (heading, lists,
// blockquote, code block) only need the caret somewhere in a block.
//
// Link uses window.prompt for the URL — tests intercept with
// page.on('dialog'). A proper popover ships with W-009 (Cmd-K link).
//
// Parallel-run flake (dev only): running all 11 of these alongside
// every other Playwright test under the default multi-worker config
// can occasionally drop a keystroke or a click under server load.
// CI uses `workers: 1` (see playwright.config.ts) so it's stable
// there. Running locally with `--workers 1` reproduces CI behavior.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

async function openFreshEditor(
  browser: import('@playwright/test').Browser,
  titlePrefix: string,
  initial: string,
): Promise<{ page: Page; editor: ReturnType<Page['locator']>; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `${titlePrefix}-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  const editor = page.getByTestId('editor').locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  // The toolbar only mounts once actions are wired up, which happens
  // at the end of Editor.svelte's async onMount (dynamic imports +
  // Yjs init). Waiting for it ensures the EditorView is fully ready
  // before any keystrokes; otherwise the type-then-click sequence
  // races the setup and we get flaky no-ops under parallelism.
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.type(initial);
  // Round-trip guard: assert the typed text actually landed in the
  // editor DOM before any toolbar click. If the EditorView is
  // mid-Yjs-sync (which can happen under heavy parallel server load),
  // keystrokes can be lost or overwritten by an incoming snapshot.
  // Waiting on the DOM tells us the local edit is committed.
  await expect(editor).toContainText(initial);
  return { page, editor, close: () => context.close() };
}

test('toolbar: bold wraps selection in <strong>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-bold', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.getByTestId('tb-bold').click();
  await expect(editor.locator('strong')).toHaveText('hello');
  await close();
});

test('toolbar: italic wraps selection in <em>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-italic', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.getByTestId('tb-italic').click();
  await expect(editor.locator('em')).toHaveText('hello');
  await close();
});

test('toolbar: strike wraps selection in <s>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-strike', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.getByTestId('tb-strike').click();
  await expect(editor.locator('s')).toHaveText('hello');
  await close();
});

test('toolbar: link wraps selection in <a href>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-link', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  // window.prompt for the URL — accept with a stub URL.
  page.on('dialog', (d) => {
    void d.accept('https://example.com/');
  });
  await page.getByTestId('tb-link').click();
  await expect(editor.locator('a[href="https://example.com/"]')).toHaveText('hello');
  await close();
});

test('toolbar: H1 turns current block into <h1>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-h1', 'hello');
  await page.getByTestId('tb-h1').click();
  await expect(editor.locator('h1')).toHaveText('hello');
  await close();
});

test('toolbar: H2 turns current block into <h2>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-h2', 'hello');
  await page.getByTestId('tb-h2').click();
  await expect(editor.locator('h2')).toHaveText('hello');
  await close();
});

test('toolbar: H3 turns current block into <h3>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-h3', 'hello');
  await page.getByTestId('tb-h3').click();
  await expect(editor.locator('h3')).toHaveText('hello');
  await close();
});

test('toolbar: bullet list wraps current block in <ul><li>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-ul', 'hello');
  await page.getByTestId('tb-bullet-list').click();
  await expect(editor.locator('ul li')).toContainText('hello');
  await close();
});

test('toolbar: ordered list wraps current block in <ol><li>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-ol', 'hello');
  await page.getByTestId('tb-ordered-list').click();
  await expect(editor.locator('ol li')).toContainText('hello');
  await close();
});

test('toolbar: blockquote wraps current block in <blockquote>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-bq', 'hello');
  await page.getByTestId('tb-blockquote').click();
  await expect(editor.locator('blockquote')).toContainText('hello');
  await close();
});

test('toolbar: code block turns current block into <pre><code>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-code', 'hello');
  await page.getByTestId('tb-code-block').click();
  await expect(editor.locator('pre')).toContainText('hello');
  await close();
});

// W-008 + W-009: editor toolbar — one test per action. Each test
// creates a fresh note, types content into the ProseMirror editor,
// applies a toolbar action, and asserts the resulting DOM contains
// the right node or mark.
//
// Marks (bold/italic/strike) require a non-empty selection; the
// tests use `Meta+A` (Mac) / `Control+A` (others) via Playwright's
// `ControlOrMeta` modifier alias. Block-type actions (heading, lists,
// blockquote, code block) only need the caret somewhere in a block.
// Link goes through the LinkPopover (W-009 replaced W-008's
// window.prompt placeholder); see editor-shortcuts.test.ts for the
// Mod-K shortcut variant of the same flow.
//
// Parallel-run flake (dev only): running all of these alongside
// every other Playwright test under the default multi-worker config
// can occasionally drop a keystroke or a click under server load.
// CI uses `workers: 1` (see playwright.config.ts) so it's stable
// there. Running locally with `--workers 1` reproduces CI behavior.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';

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

test('toolbar: link opens popover, Apply wraps selection in <a href>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tb-link', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  // Defensive: if anything still tried to open a window.prompt this
  // listener would auto-dismiss it, so the assertion below would fail
  // explicitly rather than silently hang.
  page.on('dialog', (d) => {
    void d.dismiss();
  });
  await page.getByTestId('tb-link').click();
  await expect(page.getByTestId('link-popover')).toBeVisible();
  await page.getByTestId('link-popover-input').fill('https://example.com/');
  await page.getByTestId('link-popover-input').press('Enter');
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

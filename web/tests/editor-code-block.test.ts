// W-011: code block with language picker + Shiki syntax highlighting.
//
// Each code_block has a `language` attr (defaults to 'text'). The
// editor renders code_blocks via a NodeView that injects a small
// "Lang: X ▾" button next to the editable <code>. Clicking the button
// opens a CodeLangPopover with a short curated language list; picking
// one dispatches a setNodeMarkup transaction.
//
// Once a non-'text' language is set, a ProseMirror plugin tokenizes
// the code via Shiki and overlays inline decorations carrying
// `shiki-tok-<type>` classes (keyword, string, number, comment, etc.)
// plus inline color styles. The spec test ("rendered code block has
// correct token classes") asserts on the class shape.
//
// The toolbar already creates a code_block (W-008); we keep that path
// and just add the picker + highlighting on top.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';

test('toolbar "Code block" still produces <pre><code> (regression)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'cb-toolbar', 'hello');
  await page.getByTestId('tb-code-block').click();
  await expect(editor.locator('pre')).toContainText('hello');
  await close();
});

test('code block renders a language picker button (W-011)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'cb-button', 'inside');
  await page.getByTestId('tb-code-block').click();
  // NodeView injects the picker; default language is 'text' so the
  // button label starts with "text".
  await expect(editor.getByTestId('code-lang-button')).toBeVisible();
  await expect(editor.getByTestId('code-lang-button')).toContainText('text');
  await close();
});

test('picker click opens the CodeLangPopover (W-011)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'cb-popover', 'x');
  await page.getByTestId('tb-code-block').click();
  await editor.getByTestId('code-lang-button').click();
  await expect(page.getByTestId('code-lang-popover')).toBeVisible();
  // The popover lists multiple languages; we don't pin the exact list
  // shape — just sanity that ts is one of them.
  await expect(page.getByTestId('code-lang-popover')).toContainText('ts');
  await close();
});

test('selecting a language updates the code_block + shows token classes (W-011)', async ({
  browser,
}) => {
  const { page, editor, close } = await openFreshEditor(browser, 'cb-tokens');
  await page.getByTestId('tb-code-block').click();
  await page.keyboard.type('function foo() {}');

  await editor.getByTestId('code-lang-button').click();
  await page.getByTestId('code-lang-option-ts').click();

  await expect(page.getByTestId('code-lang-popover')).toBeHidden();
  // Button label reflects the new language.
  await expect(editor.getByTestId('code-lang-button')).toContainText('ts');
  // data-language on the <pre> drives both the CSS hook and the
  // highlighter plugin's per-block dispatch.
  await expect(editor.locator('pre[data-language="ts"]')).toBeVisible();
  // The Shiki plugin emits inline decorations with shiki-tok-<type>
  // classes; "function" is a keyword in TypeScript, so we should see
  // at least one keyword token wrapping a span.
  await expect(editor.locator('pre .shiki-tok-keyword').first()).toBeVisible();
  await close();
});

test('language attr survives a page reload (W-011 spec test)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'cb-persist');
  await page.getByTestId('tb-code-block').click();
  await page.keyboard.type('let x = 1;');

  await editor.getByTestId('code-lang-button').click();
  await page.getByTestId('code-lang-option-ts').click();
  await expect(editor.locator('pre[data-language="ts"]')).toBeVisible();
  // Let the HocuspocusProvider flush before we tear the page down.
  await page.waitForTimeout(500);

  await page.reload();
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await expect(editor.locator('pre[data-language="ts"]')).toBeVisible();
  await expect(editor.getByTestId('code-lang-button')).toContainText('ts');
  await close();
});

test('Escape closes the popover without changing the language (W-011)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'cb-escape', 'y');
  await page.getByTestId('tb-code-block').click();
  await editor.getByTestId('code-lang-button').click();
  await expect(page.getByTestId('code-lang-popover')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('code-lang-popover')).toBeHidden();
  // Language remains the default.
  await expect(editor.getByTestId('code-lang-button')).toContainText('text');
  await close();
});

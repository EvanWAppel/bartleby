// W-009: markdown-style autocomplete on empty lines. Typing the
// trigger at the start of an empty block converts it to the matching
// block type via prosemirror-inputrules:
//
//   "# "    -> heading level 1
//   "## "   -> heading level 2
//   "### "  -> heading level 3
//   "- "    -> bullet_list (item)
//   "1. "   -> ordered_list (item)
//   "> "    -> blockquote
//
// The input rules are anchored at the block start so triggers in the
// middle of a line stay literal — that satisfies the spec's "on empty
// line" wording.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';

test('"# " converts the current block into <h1>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'ac-h1');
  await page.keyboard.type('# title');
  await expect(editor.locator('h1')).toContainText('title');
  await close();
});

test('"## " converts the current block into <h2>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'ac-h2');
  await page.keyboard.type('## title');
  await expect(editor.locator('h2')).toContainText('title');
  await close();
});

test('"### " converts the current block into <h3>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'ac-h3');
  await page.keyboard.type('### title');
  await expect(editor.locator('h3')).toContainText('title');
  await close();
});

test('"- " wraps the current block in <ul><li>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'ac-ul');
  await page.keyboard.type('- first');
  await expect(editor.locator('ul li')).toContainText('first');
  await close();
});

test('"1. " wraps the current block in <ol><li>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'ac-ol');
  await page.keyboard.type('1. first');
  await expect(editor.locator('ol li')).toContainText('first');
  await close();
});

test('"> " wraps the current block in <blockquote>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'ac-bq');
  await page.keyboard.type('> quote');
  await expect(editor.locator('blockquote')).toContainText('quote');
  await close();
});

test('input rule only fires at block start, not mid-line', async ({ browser }) => {
  // Negative assertion: typing "# " after some text should remain a
  // literal hash, not convert the paragraph to a heading.
  const { page, editor, close } = await openFreshEditor(browser, 'ac-neg', 'hello ');
  await page.keyboard.type('# more');
  await expect(editor.locator('h1')).toHaveCount(0);
  await expect(editor.locator('p')).toContainText('hello # more');
  await close();
});

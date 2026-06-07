// W-009: keyboard shortcuts in the editor.
//
//   Mod-B          -> toggle bold (strong)
//   Mod-I          -> toggle italic (em)
//   Mod-Shift-X    -> toggle strike
//   Mod-K          -> open the link popover (replaces W-008's
//                     window.prompt placeholder); URL input + Apply
//                     applies the link mark to the saved selection.
//
// "Mod" maps to Cmd on Mac and Ctrl elsewhere; Playwright's
// `ControlOrMeta` modifier alias matches what prosemirror-keymap's
// `Mod-*` does, so the same key string works on every host.
//
// See editor-toolbar.test.ts for the parallel-flake note; CI uses
// workers:1 so it's stable there.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';

test('Mod-B on selection wraps in <strong>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'sc-bold', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+b');
  await expect(editor.locator('strong')).toHaveText('hello');
  await close();
});

test('Mod-I on selection wraps in <em>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'sc-italic', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(editor.locator('em')).toHaveText('hello');
  await close();
});

test('Mod-Shift-X on selection wraps in <s>', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'sc-strike', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+Shift+x');
  await expect(editor.locator('s')).toHaveText('hello');
  await close();
});

test('Mod-K with selection opens the link popover and applies the link on submit', async ({
  browser,
}) => {
  const { page, editor, close } = await openFreshEditor(browser, 'sc-link', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+k');

  const popover = page.getByTestId('link-popover');
  await expect(popover).toBeVisible();

  const input = page.getByTestId('link-popover-input');
  await expect(input).toBeFocused();
  await input.fill('https://example.com/');
  await input.press('Enter');

  await expect(popover).toBeHidden();
  await expect(editor.locator('a[href="https://example.com/"]')).toHaveText('hello');
  await close();
});

test('Mod-K + Escape closes the popover without applying a link', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'sc-link-esc', 'hello');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+k');

  const popover = page.getByTestId('link-popover');
  await expect(popover).toBeVisible();

  await page.getByTestId('link-popover-input').press('Escape');
  await expect(popover).toBeHidden();
  await expect(editor.locator('a')).toHaveCount(0);
  await close();
});

test('Mod-K on an empty selection is a no-op', async ({ browser }) => {
  // W-009 chooses strict semantics: no selection means no link target,
  // so the popover does not open. (Pasting the URL as both text and
  // href is a possible future relaxation.)
  const { page, close } = await openFreshEditor(browser, 'sc-link-noop');
  await page.keyboard.press('ControlOrMeta+k');
  // Negative assertion with a short timeout so the test doesn't wait
  // for the full default 5s — the popover should never appear.
  await expect(page.getByTestId('link-popover')).toBeHidden({ timeout: 500 });
  await close();
});

// "Toolbar Link button opens the popover" is covered by the W-008/W-009
// merged test in editor-toolbar.test.ts ("toolbar: link opens popover,
// Apply wraps selection in <a href>") to avoid duplicate end-to-end
// coverage of the same path.

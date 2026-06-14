// W-010: task list rendering + toggle. Task lists are a separate
// node-type pair from bullet lists:
//
//   task_list  -- group: block, content: 'task_item+'
//   task_item  -- attrs: { checked: boolean }, content: 'paragraph block*'
//
// The web renders task_item via a NodeView that injects a real
// <input type="checkbox"> next to the editable content. Tests select
// on `[data-type="task-list"]` / `[data-type="task-item"]` so the
// selectors don't collide with the bullet/ordered-list <ul>/<ol>
// the toolbar tests already use.
//
// Toggle UX (per W-010's "click checkbox or Space when caret inside"):
//   - Click the checkbox: always works
//   - Space at position 0 of an EMPTY task_item: toggles
//   - Space anywhere else: types a literal space
//
// Persistence: the toggle dispatches a normal ProseMirror tx, which
// flows through y-prosemirror to Hocuspocus. A short wait before
// reload lets the HocuspocusProvider flush before we tear the
// page down.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';

test('typing "- [ ] foo" creates an unchecked task list', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tl-create-unchecked');
  await page.keyboard.type('- [ ] foo');
  await expect(editor.locator('ul[data-type="task-list"]')).toBeVisible();
  await expect(editor.locator('li[data-type="task-item"]')).toContainText('foo');
  await expect(editor.locator('input[type="checkbox"]')).not.toBeChecked();
  await close();
});

test('typing "- [x] done" creates a checked task list', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tl-create-checked');
  await page.keyboard.type('- [x] done');
  await expect(editor.locator('li[data-type="task-item"]')).toContainText('done');
  await expect(editor.locator('input[type="checkbox"]')).toBeChecked();
  await close();
});

test('clicking the checkbox toggles checked state', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tl-click-toggle');
  await page.keyboard.type('- [ ] foo');
  const checkbox = editor.locator('input[type="checkbox"]');
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await close();
});

test('toggle persists across page reload (W-010 spec test)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'tl-persist');
  await page.keyboard.type('- [ ] foo');
  const checkbox = editor.locator('input[type="checkbox"]');
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  // Let the HocuspocusProvider flush the toggle tx to the server
  // before we navigate away. The provider syncs sub-second on idle
  // but a small explicit wait keeps the test deterministic.
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await expect(editor.locator('input[type="checkbox"]')).toBeChecked();
  await expect(editor.locator('li[data-type="task-item"]')).toContainText('foo');
  await close();
});

test('Space at position 0 of empty task item toggles checked', async ({ browser }) => {
  // After "- [ ] " the input rule has fired and the caret is at the
  // start of an empty task_item content area. Pressing Space here
  // should toggle the item to checked rather than typing a literal
  // space (per the W-010 spec's "Space when caret inside" wording,
  // narrowed to the empty-item start case so it doesn't break normal
  // typing once the user adds text).
  const { page, editor, close } = await openFreshEditor(browser, 'tl-space-toggle');
  await page.keyboard.type('- [ ] ');
  await page.keyboard.press('Space');
  await expect(editor.locator('input[type="checkbox"]')).toBeChecked();
  await close();
});

test('Space mid-text types a literal space (no toggle)', async ({ browser }) => {
  // Negative: once the task_item has text, Space is just a character.
  // This pins the "doesn't break normal typing" invariant.
  const { page, editor, close } = await openFreshEditor(browser, 'tl-space-mid');
  await page.keyboard.type('- [ ] hello');
  await page.keyboard.press('Space');
  await page.keyboard.type('world');
  await expect(editor.locator('li[data-type="task-item"]')).toContainText('hello world');
  await expect(editor.locator('input[type="checkbox"]')).not.toBeChecked();
  await close();
});

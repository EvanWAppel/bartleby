// W-012: [[backlink]] autocomplete + clickable rendered backlink.
//
// Trigger: typing `[[` in any paragraph opens the picker. The query is
// the text typed AFTER `[[` (Obsidian/Notion convention). Apply
// replaces `[[query` with a backlink atom node carrying { targetId,
// title }. Escape closes the picker but leaves the literal `[[query`
// text intact (the S-009 hook will still resolve it server-side via
// the existing regex extractor).
//
// Rendering: the backlink renders as a plain <a href="/n/{id}">. Plain
// click navigates client-side via SvelteKit, matching the spec test's
// "click navigates" requirement.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';
import { createNote } from './helpers/notes.js';

test('typing "[[" opens the backlink picker (W-012)', async ({ browser }) => {
  // Pre-seed two notes so the picker has something to populate.
  const stamp = String(Date.now());
  const ctx = await browser.newContext();
  const { signIn } = await import('./helpers/auth.js');
  await signIn(ctx);
  await createNote(ctx, `bl-target-alpha-${stamp}`);
  await createNote(ctx, `bl-target-beta-${stamp}`);
  await ctx.close();

  const { page, editor, close } = await openFreshEditor(browser, 'bl-open');
  await editor.focus();
  await page.keyboard.type('[[');
  await expect(page.getByTestId('backlink-picker')).toBeVisible();
  await close();
});

test('typing after "[[" filters the picker (W-012)', async ({ browser }) => {
  // The picker lists ALL notes initially; typing narrows by case-
  // insensitive substring match against the title.
  const stamp = String(Date.now());
  const ctx = await browser.newContext();
  const { signIn } = await import('./helpers/auth.js');
  await signIn(ctx);
  await createNote(ctx, `bl-filter-keep-${stamp}`);
  await createNote(ctx, `bl-filter-skip-${stamp}`);
  await ctx.close();

  const { page, editor, close } = await openFreshEditor(browser, 'bl-filter');
  await editor.focus();
  await page.keyboard.type('[[keep');
  await expect(page.getByTestId('backlink-picker')).toBeVisible();
  // Matching candidate is visible; non-matching is gone.
  await expect(
    page.getByTestId('backlink-picker').getByText(`bl-filter-keep-${stamp}`),
  ).toBeVisible();
  await expect(
    page.getByTestId('backlink-picker').getByText(`bl-filter-skip-${stamp}`),
  ).toHaveCount(0);
  await close();
});

test('clicking a candidate inserts a backlink node (W-012)', async ({ browser }) => {
  const stamp = String(Date.now());
  const ctx = await browser.newContext();
  const { signIn } = await import('./helpers/auth.js');
  await signIn(ctx);
  await createNote(ctx, `bl-insert-target-${stamp}`);
  await ctx.close();

  const { page, editor, close } = await openFreshEditor(browser, 'bl-insert');
  await editor.focus();
  await page.keyboard.type('[[insert');
  await page.getByTestId('backlink-picker').getByText(`bl-insert-target-${stamp}`).click();
  // Picker dismissed.
  await expect(page.getByTestId('backlink-picker')).toBeHidden();
  // The atom renders as a clickable <a data-backlink> in the editor.
  await expect(editor.locator('a[data-backlink]')).toHaveText(`bl-insert-target-${stamp}`);
  // The literal `[[insert` typing is gone (replaced by the node).
  await expect(editor).not.toContainText('[[insert');
  await close();
});

test('clicking a rendered backlink navigates to the target note (W-012 spec test)', async ({
  browser,
}) => {
  const stamp = String(Date.now());
  const ctx = await browser.newContext();
  const { signIn } = await import('./helpers/auth.js');
  await signIn(ctx);
  const target = await createNote(ctx, `bl-nav-target-${stamp}`);
  await ctx.close();

  const { page, editor, close } = await openFreshEditor(browser, 'bl-nav');
  await editor.focus();
  await page.keyboard.type('[[nav');
  await page.getByTestId('backlink-picker').getByText(`bl-nav-target-${stamp}`).click();
  // Let Hocuspocus flush so the click below doesn't race the save.
  await page.waitForTimeout(300);

  await editor.locator('a[data-backlink]').click();
  await expect(page).toHaveURL(new RegExp(`/n/${target.id}$`));
  await close();
});

test('Escape closes the picker but leaves the literal "[[query" text (W-012)', async ({
  browser,
}) => {
  const { page, editor, close } = await openFreshEditor(browser, 'bl-escape');
  await editor.focus();
  await page.keyboard.type('[[leftover');
  await expect(page.getByTestId('backlink-picker')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('backlink-picker')).toBeHidden();
  // The literal text stays — the S-009 backlink extractor still
  // resolves it server-side, and we don't want to destroy typing.
  await expect(editor).toContainText('[[leftover');
  await close();
});

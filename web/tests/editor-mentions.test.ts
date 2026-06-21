// W-013: @mention picker + clickable rendered mention.
//
// Trigger: typing `@` at the start of a word opens the picker. The
// query is the text typed AFTER `@` (Slack/Notion convention). Apply
// replaces `@query` with a mention atom node carrying { email,
// displayName }. Escape closes the picker but leaves the literal
// `@query` text intact (no derived-state extractor cares about loose
// `@`s in v1).
//
// Rendering: the mention renders as a plain styled `<span data-mention>`.
// No click handler — the chip is inert in v1; the mentions inbox
// (W-023) is where you act on your own mentions from.

import { test, expect } from '@playwright/test';
import { openFreshEditor } from './helpers/editor.js';

test('typing "@" opens the mention picker (W-013)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'me-open');
  await editor.focus();
  await page.keyboard.type('@');
  await expect(page.getByTestId('mention-picker')).toBeVisible();
  await close();
});

test('typing after "@" filters the picker (W-013)', async ({ browser }) => {
  // The picker shows ALL allowlist entries initially; typing narrows by
  // case-insensitive substring match against displayName + email.
  // playwright.config.ts seeds alice@/bob@/test@ on the allowlist.
  const { page, editor, close } = await openFreshEditor(browser, 'me-filter');
  await editor.focus();
  await page.keyboard.type('@bo');
  await expect(page.getByTestId('mention-picker')).toBeVisible();
  await expect(page.getByTestId('mention-option-bob@example.com')).toBeVisible();
  await expect(page.getByTestId('mention-option-alice@example.com')).toHaveCount(0);
  await close();
});

test('clicking a candidate inserts a mention node (W-013 spec test)', async ({ browser }) => {
  const { page, editor, close } = await openFreshEditor(browser, 'me-insert');
  await editor.focus();
  await page.keyboard.type('@alice');
  await page.getByTestId('mention-option-alice@example.com').click();
  // Picker dismissed.
  await expect(page.getByTestId('mention-picker')).toBeHidden();
  // Exactly one mention atom rendered (typed `@alice` was REPLACED, not
  // appended to). Asserting count = 1 catches a "the typed text stayed
  // in the doc alongside the new node" regression without needing a
  // brittle textContent comparison (the chip's own label starts with
  // `@alice…` so substring assertions fight themselves).
  const chip = editor.locator('span[data-mention]');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute('data-mention-email', 'alice@example.com');
  // alice hasn't signed in, so the chip falls back to "@email" labeling.
  await expect(chip).toHaveText('@alice@example.com');
  await close();
});

test('selecting a signed-in user uses their displayName in the chip (W-013)', async ({
  browser,
}) => {
  // test@example.com is signed in by openFreshEditor's signIn helper,
  // which upserts a displayName of "Test User". The chip should
  // render with the displayName, not the email.
  const { page, editor, close } = await openFreshEditor(browser, 'me-display');
  await editor.focus();
  await page.keyboard.type('@test');
  await page.getByTestId('mention-option-test@example.com').click();
  await expect(page.getByTestId('mention-picker')).toBeHidden();
  const chip = editor.locator('span[data-mention]');
  await expect(chip).toHaveAttribute('data-mention-email', 'test@example.com');
  await expect(chip).toHaveAttribute('data-mention-display', 'Test User');
  await expect(chip).toHaveText('@Test User');
  await close();
});

test('Escape closes the picker but leaves the literal "@query" text (W-013)', async ({
  browser,
}) => {
  const { page, editor, close } = await openFreshEditor(browser, 'me-escape');
  await editor.focus();
  await page.keyboard.type('@leftover');
  await expect(page.getByTestId('mention-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mention-picker')).toBeHidden();
  // Literal text remains — no derived-state extractor cares about it,
  // and we don't want to destroy in-progress typing.
  await expect(editor).toContainText('@leftover');
  await close();
});

test('typing "@" mid-word does NOT open the picker (W-013)', async ({ browser }) => {
  // The trigger only fires when `@` is preceded by start-of-block or
  // whitespace; an `@` mid-word (e.g. email-typing) must stay inert so
  // the user can paste/write an email without a popover.
  const { page, editor, close } = await openFreshEditor(browser, 'me-midword');
  await editor.focus();
  await page.keyboard.type('foo@');
  await expect(page.getByTestId('mention-picker')).toBeHidden();
  await close();
});

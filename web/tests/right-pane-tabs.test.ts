// W-015: right pane tabs (Comments / Backlinks / History) + per-note
// persistence in localStorage.
//
// Tab CONTENT is placeholder in this PR — actual panes ship later
// (W-016 backlinks, W-017 comments, W-019 history). These tests cover:
//   - Tabs render on /n/[id] with the expected three buttons.
//   - Clicking a tab switches the visible panel.
//   - Tab choice survives a full page reload (per-note localStorage).
//   - Navigating to a different note's tab choice is independent.
//   - Generic placeholder (no tabs) renders on routes without a note id.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

test('right pane shows the three tabs on /n/[id] (W-015)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `rp-tabs-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  // editor-toolbar mounts after Editor.svelte's onMount completes; we
  // use that as a deterministic "page is hydrated" proxy so the tab
  // buttons below have their click handlers attached before we click.
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });

  await expect(page.getByTestId('right-pane-tablist')).toBeVisible();
  await expect(page.getByTestId('right-pane-tab-comments')).toBeVisible();
  await expect(page.getByTestId('right-pane-tab-backlinks')).toBeVisible();
  await expect(page.getByTestId('right-pane-tab-history')).toBeVisible();
  // Default tab is comments — its panel is visible, the others aren't.
  await expect(page.getByTestId('right-pane-panel-comments')).toBeVisible();
  await expect(page.getByTestId('right-pane-panel-backlinks')).toHaveCount(0);
  await expect(page.getByTestId('right-pane-panel-history')).toHaveCount(0);

  await context.close();
});

test('clicking a tab switches the visible panel (W-015)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `rp-switch-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });

  await page.getByTestId('right-pane-tab-backlinks').click();
  await expect(page.getByTestId('right-pane-panel-backlinks')).toBeVisible();
  await expect(page.getByTestId('right-pane-panel-comments')).toHaveCount(0);

  await page.getByTestId('right-pane-tab-history').click();
  await expect(page.getByTestId('right-pane-panel-history')).toBeVisible();
  await expect(page.getByTestId('right-pane-panel-backlinks')).toHaveCount(0);

  await context.close();
});

test('tab choice survives a full reload (W-015 spec test)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const note = await createNote(context, `rp-persist-${Date.now()}`);
  const page = await context.newPage();
  await page.goto(`/n/${note.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });

  await page.getByTestId('right-pane-tab-history').click();
  await expect(page.getByTestId('right-pane-panel-history')).toBeVisible();

  await page.reload();
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  // After hydration the persisted tab should be selected again, with
  // its panel visible and the others gone. aria-selected is the canonical
  // signal here.
  await expect(page.getByTestId('right-pane-tab-history')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('right-pane-panel-history')).toBeVisible();
  await expect(page.getByTestId('right-pane-panel-comments')).toHaveCount(0);

  await context.close();
});

test('per-note persistence is independent — switching notes does not stomp the other (W-015)', async ({
  browser,
}) => {
  // Two notes: A picks Backlinks, B picks History. Navigating back to A
  // shows Backlinks again — not the default and not B's choice.
  const context = await browser.newContext();
  await signIn(context);
  const stamp = String(Date.now());
  const a = await createNote(context, `rp-a-${stamp}`);
  const b = await createNote(context, `rp-b-${stamp}`);
  const page = await context.newPage();

  await page.goto(`/n/${a.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await page.getByTestId('right-pane-tab-backlinks').click();
  await expect(page.getByTestId('right-pane-panel-backlinks')).toBeVisible();

  await page.goto(`/n/${b.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  // Note B starts on the default (comments) — A's backlinks choice
  // must NOT carry over.
  await expect(page.getByTestId('right-pane-panel-comments')).toBeVisible();
  await page.getByTestId('right-pane-tab-history').click();
  await expect(page.getByTestId('right-pane-panel-history')).toBeVisible();

  // Back to A: still on Backlinks.
  await page.goto(`/n/${a.id}`);
  await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
  await expect(page.getByTestId('right-pane-tab-backlinks')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('right-pane-panel-backlinks')).toBeVisible();

  await context.close();
});

test('the right pane on / (no note) shows a hint, not the tabs (W-015)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByTestId('right-pane')).toBeVisible();
  await expect(page.getByTestId('note-right-pane')).toHaveCount(0);
  await expect(page.getByTestId('right-pane')).toContainText('Open a note');

  await context.close();
});

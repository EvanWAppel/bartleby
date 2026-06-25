// Q-005 accessibility pass. Runs axe-core scans across every key
// route (login, home/notes-list, editor, trash, inbox, search overlay)
// and asserts zero violations. The test is intentionally strict —
// suppressing real violations would defeat the point. If a route grows
// a genuinely unfixable rule (e.g. a third-party iframe color-contrast
// issue), document it inline with a comment and an `.disableRules([…])`
// call rather than ignoring the assertion.
//
// Pattern: each scan navigates the page, waits for a known
// post-hydration element to settle (no arbitrary timeouts), then runs
// AxeBuilder({ page }).analyze() and asserts violations.length === 0.
// The assertion includes the violation ids in the failure message so
// CI logs are immediately actionable.

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

interface AxeViolation {
  id: string;
  description: string;
  nodes: { html: string }[];
}

function formatViolations(violations: AxeViolation[]): string {
  if (violations.length === 0) return '';
  return violations
    .map((v) => `  - ${v.id}: ${v.description}\n    ${v.nodes.map((n) => n.html).join('\n    ')}`)
    .join('\n');
}

async function scan(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    // WCAG 2.1 AA (the level the task targets) is the union of these
    // tags; axe applies the matching rules.
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations,
    `axe violations on ${context}:\n${formatViolations(results.violations as AxeViolation[])}`,
  ).toEqual([]);
}

test.describe('a11y: axe scan on key routes', () => {
  test('/login (unauthenticated) has no axe violations', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login').waitFor({ state: 'visible' });
    await scan(page, '/login');
  });

  test('/ (home/notes-list) has no axe violations', async ({ browser }) => {
    const ctx = await browser.newContext();
    // Per-test email so the sidebar's notes-list stays small and
    // deterministic — sharing the default user with parallel tests
    // would balloon the rendered list and slow the scan.
    const stamp = String(Date.now());
    await signIn(ctx, { email: `a11y-home-${stamp}@example.com`, displayName: 'A11y Home' });
    // Seed the user with at least one note so the sidebar renders the
    // notes list + trash-row buttons (the empty-list branch hides
    // several interactive elements we want covered by the scan).
    await createNote(ctx, `a11y-home-${stamp}`);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await page.getByTestId('empty-state').waitFor({ state: 'visible' });
    // Wait for the notes list to populate (polled every 1s) so the
    // scan sees the per-row trash buttons too.
    await page.getByTestId('notes-list-item').first().waitFor({ state: 'visible', timeout: 5_000 });
    await scan(page, '/');
    await ctx.close();
  });

  test('/n/[id] (editor) has no axe violations', async ({ browser }) => {
    const ctx = await browser.newContext();
    await signIn(ctx);
    const note = await createNote(ctx, `a11y-editor-${Date.now()}`);
    const page = await ctx.newPage();
    await page.goto(`/n/${note.id}`);
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
    await page.getByTestId('editor').locator('.ProseMirror').waitFor({ state: 'visible' });
    // Right pane mounts the comments tab by default; wait for it to
    // settle so the scan covers the tablist + active panel.
    await page.getByTestId('right-pane-tablist').waitFor({ state: 'visible' });
    await scan(page, '/n/[id]');
    await ctx.close();
  });

  test('/trash has no axe violations', async ({ browser }) => {
    const ctx = await browser.newContext();
    await signIn(ctx);
    // Soft-delete a note so /trash renders the row + actions, not
    // just the empty state.
    const note = await createNote(ctx, `a11y-trash-${Date.now()}`);
    const del = await ctx.request.delete(`/notes/${note.id}`);
    expect(del.ok()).toBe(true);
    const page = await ctx.newPage();
    await page.goto('/trash');
    await page.getByTestId('trash-page').waitFor({ state: 'visible' });
    await page.getByTestId(`trash-row-${note.id}`).waitFor({ state: 'visible' });
    await scan(page, '/trash');
    await ctx.close();
  });

  test('/inbox has no axe violations', async ({ browser }) => {
    const ctx = await browser.newContext();
    await signIn(ctx);
    const page = await ctx.newPage();
    await page.goto('/inbox');
    await page.getByTestId('inbox-page').waitFor({ state: 'visible' });
    // The empty-state branch is fine to scan — it still exercises the
    // page chrome (h1, hint text, etc.). A populated inbox would
    // require an inbound mention which is N-002 territory.
    await scan(page, '/inbox');
    await ctx.close();
  });

  test('search overlay has no axe violations', async ({ browser }) => {
    const ctx = await browser.newContext();
    await signIn(ctx);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    // Same Cmd-K + poll dance the search-overlay suite uses to
    // tolerate the SearchOverlay onMount race.
    await expect
      .poll(
        async () => {
          await page.keyboard.press('ControlOrMeta+k');
          return await page.getByTestId('search-overlay').isVisible();
        },
        { timeout: 8_000, intervals: [200, 200, 400] },
      )
      .toBe(true);
    await page.getByTestId('search-overlay-input').waitFor({ state: 'visible' });
    await scan(page, 'search overlay');
    await ctx.close();
  });

  test('confirm-dialog (move-to-trash modal) has no axe violations', async ({ browser }) => {
    const ctx = await browser.newContext();
    await signIn(ctx);
    const note = await createNote(ctx, `a11y-modal-${Date.now()}`);
    const page = await ctx.newPage();
    await page.goto(`/n/${note.id}`);
    await page.getByTestId('editor-toolbar').waitFor({ state: 'visible' });
    await page.getByTestId('note-view-trash').click();
    await page.getByTestId('confirm-dialog').waitFor({ state: 'visible' });
    await scan(page, 'confirm-dialog');
    await ctx.close();
  });
});

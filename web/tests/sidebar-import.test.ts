// W-025 drag-and-drop import: drop one or more `.md` files onto the
// notes list → POST each via the I-003 import endpoint → appear in
// list within the 1s NotesStore poll window.
//
// Native browser drag-and-drop from a DataTransfer is awkward to
// synthesize in Playwright (the real File constructor doesn't play
// nice with page.evaluate). The component exposes a hidden
// <input type="file"> fallback the drop handler wires up — same code
// path on the SvelteKit + server side, less Playwright drag-event
// plumbing. The drop handler itself is also covered by the server-
// side routes test (src/import/routes.test.ts); this e2e pins the
// user flow end-to-end.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';

test('dropping 2 .md files onto the sidebar creates 2 notes (W-025)', async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context);
  const page = await context.newPage();
  await page.goto('/');

  // Wait for hydration: the import-input's change listener is attached
  // via $effect, which only runs once Svelte has hydrated. Without
  // this gate, setInputFiles can fire `change` before the listener is
  // attached and the upload silently no-ops. We probe by clicking the
  // input's label which is a no-op in headless (no file picker UI) but
  // forces Playwright to materialize the element and gives the runtime
  // a tick to attach handlers.
  await expect(page.getByTestId('sidebar')).toBeVisible();
  const input = page.getByTestId('sidebar-import-input');
  await expect(input).toHaveCount(1);
  // Wait until the change listener has actually been attached. The
  // listener is added in a $effect, so we poll DOM until the
  // `onclick`/event-handlers map shows we're hydrated. Cleanest signal
  // available: page.evaluate confirming an explicit hydration flag we
  // set in Sidebar's onMount.
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as { __sidebarHydrated?: boolean }).__sidebarHydrated)),
    )
    .toBe(true);

  const unique = `${Date.now()}`;
  const titleA = `imported-A-${unique}`;
  const titleB = `imported-B-${unique}`;

  await input.setInputFiles([
    {
      name: 'note-a.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(`---\ntitle: ${titleA}\ntags: [imported]\n---\n\nbody for A`, 'utf-8'),
    },
    {
      name: 'note-b.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(`---\ntitle: ${titleB}\ntags: [imported]\n---\n\nbody for B`, 'utf-8'),
    },
  ]);

  // Both rows appear in the list. The handler calls store.refresh()
  // immediately after upload, but the 1s poll would also pick them
  // up — generous timeout for CI.
  await expect(page.getByTestId('notes-list-item').filter({ hasText: titleA })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId('notes-list-item').filter({ hasText: titleB })).toBeVisible({
    timeout: 5000,
  });

  await context.close();
});

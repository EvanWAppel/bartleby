// W-021: tag-filter chips in the sidebar.
//
// Spec test: "click cycles" — click a chip to filter to that tag, click
// the same chip again to clear back to the full list.
//
// We use the PATCH /notes/:id endpoint to attach tags (W-007's retag
// path). Filtering happens client-side off the polled NotesStore so
// the chip set stays stable — see Sidebar.svelte for the rationale.

import { test, expect, type BrowserContext } from '@playwright/test';
import { signIn } from './helpers/auth.js';
import { createNote } from './helpers/notes.js';

async function tagNote(ctx: BrowserContext, id: string, tags: string[]): Promise<void> {
  const res = await ctx.request.patch(`/notes/${id}`, { data: { tags } });
  if (!res.ok()) {
    throw new Error(`tagNote failed: ${res.status()} ${await res.text()}`);
  }
}

test('clicking a tag chip filters the notes list; clicking again clears (W-021 spec test)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const stamp = String(Date.now());
  // Two travel notes + one cooking note. Filter on #travel should
  // hide the cooking note; clearing should bring it back.
  const travel1 = await createNote(ctx, `tag-travel-1-${stamp}`);
  const travel2 = await createNote(ctx, `tag-travel-2-${stamp}`);
  const cooking = await createNote(ctx, `tag-cooking-${stamp}`);
  const travelTag = `travel${stamp}`;
  const cookingTag = `cooking${stamp}`;
  await tagNote(ctx, travel1.id, [travelTag]);
  await tagNote(ctx, travel2.id, [travelTag]);
  await tagNote(ctx, cooking.id, [cookingTag]);

  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ state: 'visible' });
  // The sidebar polls /notes on a 1s cadence; wait until both chips
  // are present before asserting filter behavior.
  await expect(page.getByTestId(`sidebar-tag-chip-${travelTag}`)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId(`sidebar-tag-chip-${cookingTag}`)).toBeVisible();

  // Pre-filter: all three notes visible.
  await expect(page.getByText(travel1.title)).toBeVisible();
  await expect(page.getByText(travel2.title)).toBeVisible();
  await expect(page.getByText(cooking.title)).toBeVisible();

  // Click #travel chip — cooking note hides; both travel notes stay.
  await page.getByTestId(`sidebar-tag-chip-${travelTag}`).click();
  await expect(page.getByTestId(`sidebar-tag-chip-${travelTag}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(travel1.title)).toBeVisible();
  await expect(page.getByText(travel2.title)).toBeVisible();
  await expect(page.getByText(cooking.title)).toHaveCount(0);
  // The cooking chip is still visible so the user can switch filters.
  await expect(page.getByTestId(`sidebar-tag-chip-${cookingTag}`)).toBeVisible();

  // Click #travel again — filter clears, all notes visible again.
  await page.getByTestId(`sidebar-tag-chip-${travelTag}`).click();
  await expect(page.getByTestId(`sidebar-tag-chip-${travelTag}`)).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByText(travel1.title)).toBeVisible();
  await expect(page.getByText(travel2.title)).toBeVisible();
  await expect(page.getByText(cooking.title)).toBeVisible();

  await ctx.close();
});

test('switching from one tag to another swaps the visible filter (W-021)', async ({ browser }) => {
  // Clicking a second chip while a first is active should ACTIVATE
  // the second and DEACTIVATE the first — not stack as an OR/AND
  // filter (v1's filter model is single-tag for ergonomic simplicity).
  const ctx = await browser.newContext();
  await signIn(ctx);
  const stamp = String(Date.now());
  const a = await createNote(ctx, `tag-A-${stamp}`);
  const b = await createNote(ctx, `tag-B-${stamp}`);
  const tagA = `alpha${stamp}`;
  const tagB = `beta${stamp}`;
  await tagNote(ctx, a.id, [tagA]);
  await tagNote(ctx, b.id, [tagB]);

  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId(`sidebar-tag-chip-${tagA}`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId(`sidebar-tag-chip-${tagB}`)).toBeVisible();

  await page.getByTestId(`sidebar-tag-chip-${tagA}`).click();
  await expect(page.getByText(a.title)).toBeVisible();
  await expect(page.getByText(b.title)).toHaveCount(0);

  await page.getByTestId(`sidebar-tag-chip-${tagB}`).click();
  await expect(page.getByTestId(`sidebar-tag-chip-${tagA}`)).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByTestId(`sidebar-tag-chip-${tagB}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(b.title)).toBeVisible();
  await expect(page.getByText(a.title)).toHaveCount(0);

  await ctx.close();
});

test('a tag with no matching notes shows an explanatory empty state (W-021)', async ({
  browser,
}) => {
  // After a filter is active, deleting / retagging all matching notes
  // could leave the chip pointing at nothing. The sidebar shouldn't
  // just go blank — we want a clear "no notes tagged #X" message.
  const ctx = await browser.newContext();
  await signIn(ctx);
  const stamp = String(Date.now());
  const note = await createNote(ctx, `tag-empty-${stamp}`);
  const tag = `solo${stamp}`;
  await tagNote(ctx, note.id, [tag]);

  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByTestId(`sidebar-tag-chip-${tag}`)).toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`sidebar-tag-chip-${tag}`).click();
  // Now strip the tag off the only note that had it.
  await tagNote(ctx, note.id, []);
  // NotesStore polls every 1s — wait for the next poll to surface the
  // empty-filtered state. The chip itself drops off the available list
  // once no note carries the tag anymore; that auto-clears the filter
  // visually (no chip means activeTag's `aria-pressed=true` simply
  // disappears from the DOM, and the chip's tag identity moves on).
  await expect(page.getByTestId('notes-list-empty-filtered')).toBeVisible({ timeout: 5_000 });

  await ctx.close();
});

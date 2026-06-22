// W-025: drag-and-drop markdown import on the sidebar.
//
// Spec test: "drop 2 files → 2 new notes appear."
//
// Playwright doesn't simulate native OS-level file drops well, so we
// drive the import via DataTransfer + dispatched dragover/drop events
// at the Sidebar element. The component listens for those exact events;
// the rest of the flow (POST /notes/import + NotesStore.refresh) is
// identical to the real user gesture.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers/auth.js';

async function dispatchDropOnSidebar(
  page: Page,
  files: { name: string; content: string; mime?: string }[],
): Promise<void> {
  // Synthesize the full dragover + drop sequence in the page. The
  // DragEvent constructor doesn't accept a `dataTransfer` directly in
  // Chromium, so we attach it after-the-fact via Object.defineProperty.
  // The Sidebar listens via addEventListener (Svelte 5's template-
  // level `ondrop=` doesn't wire reliably for drag events) so the
  // dispatched events route to our handler.
  await page.evaluate((specs) => {
    const sidebar = document.querySelector('[data-testid="sidebar"]') as HTMLElement;
    const dt = new DataTransfer();
    for (const s of specs) {
      dt.items.add(new File([s.content], s.name, { type: s.mime ?? 'text/markdown' }));
    }
    const fire = (type: string): void => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      sidebar.dispatchEvent(ev);
    };
    fire('dragover');
    fire('drop');
  }, files);
}

test('drop two .md files → two new notes appear in the sidebar (W-025 spec test)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ state: 'visible' });
  // The Sidebar attaches drag listeners in onMount via addEventListener
  // (Svelte 5's template-level `ondrop=` doesn't wire reliably). Wait
  // for hydration before dispatching so the listener is in place.
  await page.waitForLoadState('networkidle');

  const stamp = String(Date.now());
  await dispatchDropOnSidebar(page, [
    { name: `imp-a-${stamp}.md`, content: '# First imported\n\nbody A' },
    { name: `imp-b-${stamp}.md`, content: '# Second imported\n\nbody B' },
  ]);

  // The two new notes show up in the sidebar within one poll cycle
  // (NotesStore.refresh() fires right after the import POST returns).
  await expect(page.getByText(`imp-a-${stamp}`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(`imp-b-${stamp}`)).toBeVisible({ timeout: 5_000 });

  await ctx.close();
});

test('frontmatter title wins over filename (W-025)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ state: 'visible' });
  // The Sidebar attaches drag listeners in onMount via addEventListener
  // (Svelte 5's template-level `ondrop=` doesn't wire reliably). Wait
  // for hydration before dispatching so the listener is in place.
  await page.waitForLoadState('networkidle');

  const stamp = String(Date.now());
  await dispatchDropOnSidebar(page, [
    {
      name: `ugly-filename-${stamp}.md`,
      content: `---\ntitle: Pretty Title ${stamp}\n---\nbody`,
    },
  ]);
  await expect(page.getByText(`Pretty Title ${stamp}`)).toBeVisible({ timeout: 5_000 });
  // Filename-derived title should NOT also surface in the sidebar.
  await expect(page.getByText(`ugly-filename-${stamp}`)).toHaveCount(0);

  await ctx.close();
});

test('frontmatter tags land on the imported note and surface as chips (W-025)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ state: 'visible' });
  // The Sidebar attaches drag listeners in onMount via addEventListener
  // (Svelte 5's template-level `ondrop=` doesn't wire reliably). Wait
  // for hydration before dispatching so the listener is in place.
  await page.waitForLoadState('networkidle');

  const stamp = String(Date.now());
  const tag = `imptag${stamp}`;
  await dispatchDropOnSidebar(page, [
    {
      name: `tagged-${stamp}.md`,
      content: `---\ntitle: Tagged ${stamp}\ntags: [${tag}]\n---\nbody`,
    },
  ]);
  // Sidebar tag-filter chip appears for the new tag.
  await expect(page.getByTestId(`sidebar-tag-chip-${tag}`)).toBeVisible({ timeout: 5_000 });

  await ctx.close();
});

test('non-markdown files are ignored (W-025)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor({ state: 'visible' });
  // The Sidebar attaches drag listeners in onMount via addEventListener
  // (Svelte 5's template-level `ondrop=` doesn't wire reliably). Wait
  // for hydration before dispatching so the listener is in place.
  await page.waitForLoadState('networkidle');

  const stamp = String(Date.now());
  // Dropping a .txt file should produce no import — the sidebar
  // never reaches the POST path because the .md filter rejects it.
  // Pass mime: 'text/plain' explicitly so the type-based fallback
  // (which accepts anything containing "markdown") doesn't kick in.
  await dispatchDropOnSidebar(page, [
    { name: `not-markdown-${stamp}.txt`, content: 'plain text body', mime: 'text/plain' },
  ]);
  // Confirm the row never appears.
  await page.waitForTimeout(1_500);
  await expect(page.getByText(`not-markdown-${stamp}`)).toHaveCount(0);

  await ctx.close();
});

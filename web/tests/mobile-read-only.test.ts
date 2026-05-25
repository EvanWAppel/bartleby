import { test, expect } from '@playwright/test';

// X-001..X-004: mobile renders a read-only reader + an "open on desktop"
// banner; desktop renders the full editor. Per-project Playwright
// emulation drives the same assertions through both sides.

test.describe('mobile read-only surface', () => {
  test('renders the expected surface for this viewport', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name.startsWith('mobile-');
    await page.goto('/');

    if (isMobile) {
      // Editor surface is hidden via CSS below 768px; reader + banner appear.
      await expect(page.getByTestId('editor')).toBeHidden();
      await expect(page.getByTestId('mobile-reader')).toBeVisible();
      await expect(page.getByTestId('desktop-banner')).toBeVisible();
    } else {
      // Desktop chromium: editor visible, mobile shell hidden.
      await expect(page.getByTestId('editor')).toBeVisible();
      await expect(page.getByTestId('mobile-reader')).toBeHidden();
      await expect(page.getByTestId('desktop-banner')).toBeHidden();
    }
  });

  test('desktop-banner mailto: contains the current page URL', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile-only test');

    const room = `mobile-banner-${Date.now()}`;
    await page.goto(`/?room=${room}`);

    const link = page.getByTestId('desktop-banner-link');
    await expect(link).toBeVisible();

    // href is filled in on mount (depends on window.location.href which
    // SSR doesn't have); poll until it has the encoded URL.
    await expect(link).toHaveAttribute('href', /^mailto:\?subject=.+&body=.+/);

    const href = await link.getAttribute('href');
    expect(href, 'mailto href should be present').not.toBeNull();
    // The URL with the room param should appear inside the encoded body.
    const decoded = decodeURIComponent(href!);
    expect(decoded).toContain(`room=${room}`);
  });

  test('reader does not accept keyboard input', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile-only test');

    const room = `mobile-readonly-${Date.now()}`;
    await page.goto(`/?room=${room}`);

    const reader = page.getByTestId('mobile-reader').locator('.ProseMirror');
    await reader.waitFor({ state: 'visible' });

    // Try to type. ProseMirror with editable: () => false should ignore.
    await reader.click();
    await page.keyboard.type('this should not appear');

    // Give any pending edits a moment to land, then assert nothing changed.
    await page.waitForTimeout(200);
    await expect(reader).not.toContainText('this should not appear');
  });
});

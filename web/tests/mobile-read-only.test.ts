// X-001..X-004 with W's authenticated routing: the editor / mobile
// reader / desktop-banner live on /n/[id], not /. Tests use the
// signIn helper to skip OAuth.

import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth.js';

test.describe('mobile read-only surface', () => {
  test('renders the expected surface for this viewport', async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();

    const id = `mobile-render-${Date.now()}`;
    await page.goto(`/n/${id}`);
    const isMobile = testInfo.project.name.startsWith('mobile-');

    if (isMobile) {
      await expect(page.getByTestId('editor')).toBeHidden();
      await expect(page.getByTestId('mobile-reader')).toBeVisible();
      await expect(page.getByTestId('desktop-banner')).toBeVisible();
    } else {
      await expect(page.getByTestId('editor')).toBeVisible();
      await expect(page.getByTestId('mobile-reader')).toBeHidden();
      await expect(page.getByTestId('desktop-banner')).toBeHidden();
    }
    await context.close();
  });

  test('desktop-banner mailto: contains the current page URL', async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile-only test');
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();

    const id = `mobile-banner-${Date.now()}`;
    await page.goto(`/n/${id}`);

    const link = page.getByTestId('desktop-banner-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /^mailto:\?subject=.+&body=.+/);

    const href = await link.getAttribute('href');
    expect(href, 'mailto href should be present').not.toBeNull();
    const decoded = decodeURIComponent(href!);
    expect(decoded).toContain(`/n/${id}`);
    await context.close();
  });

  test('reader does not accept keyboard input', async ({ browser }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile-only test');
    const context = await browser.newContext();
    await signIn(context);
    const page = await context.newPage();

    const id = `mobile-readonly-${Date.now()}`;
    await page.goto(`/n/${id}`);

    const reader = page.getByTestId('mobile-reader').locator('.ProseMirror');
    await reader.waitFor({ state: 'visible' });
    await reader.click();
    await page.keyboard.type('this should not appear');

    await page.waitForTimeout(200);
    await expect(reader).not.toContainText('this should not appear');
    await context.close();
  });
});

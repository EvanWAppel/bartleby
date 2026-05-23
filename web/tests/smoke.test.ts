import { test, expect } from '@playwright/test';

test('home page loads (V-004 acceptance)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bartleby' })).toBeVisible();
  await expect(page.getByTestId('bootstrap')).toBeVisible();
});

test('editor accepts input and renders it (V-005 acceptance)', async ({ page }) => {
  // Use a unique room per run so accumulated state from prior runs / reuse
  // does not leak into this test.
  const room = `v005-${Date.now()}`;
  await page.goto(`/?room=${room}`);

  const editor = page.locator('.ProseMirror');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.type('hello');

  await expect(editor).toContainText('hello');
});

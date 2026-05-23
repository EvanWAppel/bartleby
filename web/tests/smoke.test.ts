import { test, expect } from '@playwright/test';

test('home page loads (V-004 acceptance)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bartleby' })).toBeVisible();
  await expect(page.getByTestId('bootstrap')).toBeVisible();
});

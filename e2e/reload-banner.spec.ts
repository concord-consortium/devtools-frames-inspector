import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/test.html');
  await page.waitForFunction('window.harness');
  await page.waitForSelector('#message-table');
});

test.describe('reload-recovery banners', () => {
  test('walks normal → reload → reopen → reload-frame → normal', async ({ page }) => {
    // Initial state: no banners visible.
    await expect(page.locator('.banner-error')).toHaveCount(0);
    await expect(page.locator('.banner-warning')).toHaveCount(0);

    // Click "Reload extension" — red banner appears, button label flips.
    const button = page.getByTestId('harness-simulate-reload-btn');
    await expect(button).toHaveText('Reload extension');
    await button.click();

    await expect(page.locator('.banner-error')).toHaveCount(1);
    await expect(page.locator('.banner-error')).toContainText(/Close and reopen DevTools/i);
    await expect(button).toHaveText('Reopen DevTools');
    // Yellow banner not yet shown — orphan detection happens after reopen.
    await expect(page.locator('.banner-warning')).toHaveCount(0);

    // Click "Reopen DevTools" — red banner clears, yellow banner appears
    // (bootstrap detects the previous-lifetime sw id on documentElement).
    await button.click();

    await expect(page.locator('.banner-error')).toHaveCount(0);
    await expect(page.locator('.banner-warning')).toHaveCount(1);
    await expect(page.locator('.banner-warning')).toContainText(/Reload the page/i);
    await expect(button).toHaveText('Reload extension');

    // Trigger a top-frame reload via the harness runtime — this fires
    // bgOnCommitted for frame 0 → clears all stale entries for the tab.
    await page.evaluate(() => {
      (window as any).harness.runtime.dispatch({ type: 'reload-frame', frameId: 0 });
    });
    await page.evaluate('window.harness.flushPromises()');

    // Yellow banner clears.
    await expect(page.locator('.banner-warning')).toHaveCount(0);
  });
});

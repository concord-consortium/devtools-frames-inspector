import { test, expect, Page } from '@playwright/test';

// Scope selectors to the messages view to avoid conflicts with hierarchy view
const messagesView = '.messages-view';

// Helper: send a message through the harness and wait for it to appear in the table.
// postMessage uses setTimeout(0) internally, so we need a short real delay
// plus flushPromises for the async chrome.runtime plumbing.
async function sendAndWait(page: Page, expr: string) {
  await page.evaluate(expr);
  // Let setTimeout(0) fire + async message routing settle
  await page.evaluate('new Promise(r => setTimeout(r, 50))');
  await page.evaluate('window.harness.flushPromises()');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/test.html');
  // Wait for the panel to render and harness to be available
  await page.waitForFunction('window.harness');
  await page.waitForSelector('#message-table');
});

test.describe('message capture and display', () => {
  test('child-to-parent message appears in the table', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "hello", value: 42 })');

    const rows = page.locator('#message-table tbody tr');
    await expect(rows).toHaveCount(1);

    // Direction column uses arrow icons with CSS classes like dir-child
    const direction = rows.first().locator('td[data-column="direction"]');
    await expect(direction).toHaveClass(/dir-child/);

    // Check message type
    const msgType = rows.first().locator('td[data-column="messageType"]');
    await expect(msgType).toHaveText('hello');
  });

  test('parent-to-child message appears in the table', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendParentToChild({ type: "greet" })');

    const rows = page.locator('#message-table tbody tr');
    await expect(rows).toHaveCount(1);

    const direction = rows.first().locator('td[data-column="direction"]');
    await expect(direction).toHaveClass(/dir-parent/);

    const msgType = rows.first().locator('td[data-column="messageType"]');
    await expect(msgType).toHaveText('greet');
  });

  test('multiple messages appear in order', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "first" })');
    await sendAndWait(page, 'window.harness.sendParentToChild({ type: "second" })');

    const rows = page.locator('#message-table tbody tr');
    await expect(rows).toHaveCount(2);

    await expect(rows.nth(0).locator('td[data-column="messageType"]')).toHaveText('first');
    await expect(rows.nth(1).locator('td[data-column="messageType"]')).toHaveText('second');
  });
});

test.describe('detail panel', () => {
  test('clicking a row opens the detail panel', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "detail-test", payload: [1, 2, 3] })');

    const view = page.locator(messagesView);

    const detailPane = view.locator('.detail-pane');

    // Detail pane should be hidden initially
    await expect(detailPane).toHaveClass(/hidden/);

    // Click the row
    await page.locator('#message-table tbody tr').first().click();

    // Detail pane should now be visible
    await expect(detailPane).not.toHaveClass(/hidden/);

    // Should show the JSON data
    await expect(view.locator('.json-tree')).toContainText('detail-test');
  });

  test('close button hides the detail panel', async ({ page }) => {
    const view = page.locator(messagesView);

    const detailPane = view.locator('.detail-pane');

    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "close-test" })');
    await page.locator('#message-table tbody tr').first().click();
    await expect(detailPane).not.toHaveClass(/hidden/);

    await view.locator('.close-detail-btn').click();
    await expect(detailPane).toHaveClass(/hidden/);
  });
});

test.describe('filtering', () => {
  test('filter by message type narrows the table', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "keep" })');
    await sendAndWait(page, 'window.harness.sendParentToChild({ type: "remove" })');
    await expect(page.locator('#message-table tbody tr')).toHaveCount(2);

    await page.locator('.filter-input').fill('type:keep');
    await expect(page.locator('#message-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#message-table tbody tr td[data-column="messageType"]')).toHaveText('keep');
  });

  test('negative filter excludes matching messages', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "alpha" })');
    await sendAndWait(page, 'window.harness.sendParentToChild({ type: "beta" })');

    await page.locator('.filter-input').fill('-type:alpha');
    await expect(page.locator('#message-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#message-table tbody tr td[data-column="messageType"]')).toHaveText('beta');
  });

  test('sourceType filter works', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "from-child" })');
    await sendAndWait(page, 'window.harness.sendParentToChild({ type: "from-parent" })');

    await page.locator('.filter-input').fill('sourceType:child');
    await expect(page.locator('#message-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#message-table tbody tr td[data-column="direction"]')).toHaveClass(/dir-child/);
  });

  test('clearing filter restores all messages', async ({ page }) => {
    await sendAndWait(page, 'window.harness.sendChildToParent({ type: "one" })');
    await sendAndWait(page, 'window.harness.sendParentToChild({ type: "two" })');

    await page.locator('.filter-input').fill('type:one');
    await expect(page.locator('#message-table tbody tr')).toHaveCount(1);

    await page.locator('.filter-input').clear();
    await expect(page.locator('#message-table tbody tr')).toHaveCount(2);
  });
});

test.describe('dynamic frames', () => {
  test('messages from a dynamically added iframe appear', async ({ page }) => {
    // Add a new iframe at runtime
    await page.evaluate(`
      window.harness.topFrame.addIframe({ url: 'https://dynamic.example.com/', iframeId: 'dynamic' });
    `);
    await page.evaluate('window.harness.flushPromises()');

    // The new iframe's window is the last child; send a message from it to the parent
    await page.evaluate(`
      const frames = window.harness.topFrame.tab.getAllFrames();
      const dynamicFrame = frames.find(f => f.currentDocument?.url === 'https://dynamic.example.com/');
      dynamicFrame.window.parent.postMessage({ type: 'from-dynamic' }, '*');
    `);
    await page.evaluate('new Promise(r => setTimeout(r, 50))');
    await page.evaluate('window.harness.flushPromises()');

    const rows = page.locator('#message-table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('td[data-column="messageType"]')).toHaveText('from-dynamic');
  });
});

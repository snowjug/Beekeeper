import type { ElectronApplication } from '@playwright/test';
import {
  expect,
  lassoAround,
  openCircleWithScreen,
  renderScreen,
  test,
  type RenderedScreen,
  type ScreenText,
} from './fixtures';

const LINES: ScreenText[] = [
  { id: 'headline', text: 'Beekeeper circles words', x: 180, baseline: 270, size: 64, bold: true },
  { id: 'contact', text: 'Write to hello@example.com about it', x: 180, baseline: 470, size: 40 },
];

async function overlayHidden(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('/circle/'),
    );
    return !win || !win.isVisible();
  });
}

async function activeSession(app: ElectronApplication): Promise<unknown> {
  return app.evaluate(() => {
    const hooks = (
      globalThis as unknown as { __beekeeper: { circleService: { current: () => unknown } } }
    ).__beekeeper;
    return hooks.circleService.current();
  });
}

test.describe('Circle to Search', () => {
  test.setTimeout(120_000);
  let screenshot: RenderedScreen;

  test.beforeEach(async ({ launched }) => {
    screenshot = await renderScreen(launched.app, LINES);
  });

  test('circling text selects it, reads it and Esc leaves no overlay behind', async ({
    launched,
  }) => {
    const page = await openCircleWithScreen(launched.app, screenshot);
    const headline = screenshot.boxes['headline'];
    if (!headline) throw new Error('missing headline box');

    await lassoAround(page, headline);
    await expect(page.getByTestId('circle-selection')).toBeVisible();
    await expect(page.getByTestId('circle-text')).toContainText('Beekeeper', { timeout: 30_000 });
    await expect(page.getByTestId('circle-text')).toContainText('circles');

    await page.keyboard.press('Escape');
    await expect.poll(() => overlayHidden(launched.app), { timeout: 5_000 }).toBe(true);
    expect(await activeSession(launched.app)).toBeNull();
  });

  test('tapping a word selects it', async ({ launched }) => {
    const page = await openCircleWithScreen(launched.app, screenshot);
    const contact = screenshot.boxes['contact'];
    if (!contact) throw new Error('missing contact box');

    await page.mouse.click(contact.x + contact.width * 0.55, contact.y + contact.height / 2);
    await expect(page.getByTestId('circle-selection')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('circle-text')).toContainText(/example|hello/i, {
      timeout: 10_000,
    });

    await page.keyboard.press('Escape');
    await expect.poll(() => overlayHidden(launched.app), { timeout: 5_000 }).toBe(true);
  });
});

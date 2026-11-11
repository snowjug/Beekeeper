import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, launchApp, pageFor, test } from './fixtures';

async function onboardingWindowOpen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (win) => win.webContents.getURL().includes('/onboarding/') && win.isVisible(),
    ),
  );
}

test('onboarding appears on the first launch only', async () => {
  test.setTimeout(120_000);
  const first = await launchApp({ settings: { onboarding: { completed: false } } });
  const userData = first.userData;
  try {
    const page = await pageFor(first.app, 'onboarding');
    await expect(page.getByRole('heading', { name: /Meet Beekeeper/ })).toBeVisible();
    expect(await onboardingWindowOpen(first.app)).toBe(true);

    await page.getByRole('button', { name: /skip tour/i }).click();
    await expect.poll(() => onboardingWindowOpen(first.app)).toBe(false);
  } finally {
    await first.app.close();
  }
  const stored = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
    onboarding: { completed: boolean };
  };
  expect(stored.onboarding.completed).toBe(true);

  const second = await launchApp({ userData });
  try {
    await new Promise((done) => setTimeout(done, 3000));
    expect(await onboardingWindowOpen(second.app)).toBe(false);
  } finally {
    await second.close();
  }
});

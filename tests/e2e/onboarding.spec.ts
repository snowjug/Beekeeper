import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchApp, pageFor, test } from './fixtures';

async function onboardingWindowOpen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (win) => win.webContents.getURL().includes('/onboarding/') && win.isVisible(),
    ),
  );
}

// The wizard ignores a repeated activation for 450 ms, so wait that out before each click.
const ACTION_COOLDOWN_MS = 500;

async function click(page: Page, button: string): Promise<void> {
  await page.waitForTimeout(ACTION_COOLDOWN_MS);
  await page.getByRole('button', { name: button }).click();
}

async function advance(page: Page, button: string, next: RegExp): Promise<void> {
  await click(page, button);
  await expect(page.getByRole('heading', { level: 1, name: next })).toBeVisible();
}

test('onboarding asks for the language and voice quality, then finishes without downloading', async () => {
  test.setTimeout(120_000);
  const launched = await launchApp({ settings: { onboarding: { completed: false } } });
  try {
    const page = await pageFor(launched.app, 'onboarding');
    await expect(page.getByRole('heading', { name: /Meet Beekeeper/ })).toBeVisible();
    await advance(page, 'Get started', /language & voice/i);
    await expect(page.getByRole('radio', { name: 'Both' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Best' })).toBeChecked();
    // Nothing is downloaded until the user asks for it.
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();

    await page.getByText('English', { exact: true }).click();
    await expect
      .poll(() =>
        launched.app.evaluate(() => {
          const hooks = (
            globalThis as unknown as {
              __beekeeper: { ctx: { settings: { get: () => { voice: { language: string } } } } };
            }
          ).__beekeeper;
          return hooks.ctx.settings.get().voice.language;
        }),
      )
      .toBe('en');

    await advance(page, 'Skip for now', /try your microphone/i);
    await advance(page, 'Skip for now', /anywhere/i);
    await advance(page, 'Continue', /all set/i);
    await expect(page.getByRole('list', { name: 'Setup summary' })).toContainText('English');
    await click(page, 'Start using Beekeeper');
    await expect.poll(() => onboardingWindowOpen(launched.app)).toBe(false);
  } finally {
    await launched.close();
  }
});

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

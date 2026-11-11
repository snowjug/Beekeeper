import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, launchApp, pageFor, test } from './fixtures';
import type { ElectronApplication } from '@playwright/test';

async function openSettings(app: ElectronApplication, section?: string) {
  await app.evaluate((_electron, id) => {
    const hooks = (
      globalThis as unknown as {
        __beekeeper: { ctx: { openers: { openSettings: (section?: string) => void } } };
      }
    ).__beekeeper;
    hooks.ctx.openers.openSettings(id);
  }, section);
  return pageFor(app, 'settings');
}

test.describe('settings', () => {
  test('the Voice page saves the language, recognition engine and voice engine', async () => {
    const launched = await launchApp();
    try {
      const page = await openSettings(launched.app, 'voice');
      await expect(page.getByRole('heading', { name: 'Voice', level: 1 })).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Auto (English + Hindi)' })).toBeChecked();
      await expect(page.getByRole('radio', { name: 'Whisper accurate' })).toBeChecked();
      await expect(page.getByRole('radio', { name: 'Natural voice' })).toBeChecked();

      await page.getByRole('radio', { name: 'Hindi', exact: true }).click();
      await page.getByText('Whisper fast', { exact: true }).click();
      await page.getByRole('radio', { name: 'Windows voices' }).click();
      await expect(page.getByRole('group', { name: 'Windows voices' })).toBeVisible();

      await expect
        .poll(() =>
          launched.app.evaluate(() => {
            const hooks = (
              globalThis as unknown as {
                __beekeeper: {
                  ctx: {
                    settings: {
                      get: () => {
                        voice: { language: string; whisperModel: string; ttsEngine: string };
                      };
                    };
                  };
                };
              }
            ).__beekeeper;
            const { language, whisperModel, ttsEngine } = hooks.ctx.settings.get().voice;
            return `${language}/${whisperModel}/${ttsEngine}`;
          }),
        )
        .toBe('hi/base/system');
    } finally {
      await launched.close();
    }
  });

  test('the Capture Studio and Dictation pages save their settings', async () => {
    const launched = await launchApp();
    try {
      const read = (section: 'capture' | 'dictation', key: string) =>
        launched.app.evaluate(
          (_electron, [name, field]: [string, string]) => {
            const hooks = (
              globalThis as unknown as {
                __beekeeper: {
                  ctx: { settings: { get: () => Record<string, Record<string, unknown>> } };
                };
              }
            ).__beekeeper;
            return hooks.ctx.settings.get()[name]?.[field];
          },
          [section, key] as [string, string],
        );

      const page = await openSettings(launched.app, 'capture');
      await expect(page.getByRole('heading', { name: 'Capture Studio', level: 1 })).toBeVisible();
      await page.getByRole('switch', { name: 'Copy automatically' }).click();
      await expect.poll(() => read('capture', 'autoCopy')).toBe(true);
      await expect(page.getByRole('button', { name: 'Take a screenshot now' })).toBeVisible();

      await openSettings(launched.app, 'dictation');
      await expect(page.getByRole('heading', { name: 'Dictation', level: 1 })).toBeVisible();
      await page.getByRole('switch', { name: 'Spoken punctuation' }).click();
      await expect.poll(() => read('dictation', 'spokenPunctuation')).toBe(false);
    } finally {
      await launched.close();
    }
  });

  test('changes apply instantly and persist across a restart', async () => {
    const first = await launchApp();
    const userData = first.userData;
    try {
      const page = await openSettings(first.app);
      await page.getByRole('radio', { name: 'Dark' }).click();
      await page.getByRole('radio', { name: 'Imperial' }).click();
      await page.getByRole('switch', { name: 'Start with Windows' }).click();

      // The main process validated and applied the change right away (no Save button).
      await expect
        .poll(() =>
          first.app.evaluate(() => {
            const hooks = (
              globalThis as unknown as {
                __beekeeper: {
                  ctx: { settings: { get: () => { general: { theme: string; units: string } } } };
                };
              }
            ).__beekeeper;
            const { theme, units } = hooks.ctx.settings.get().general;
            return `${theme}/${units}`;
          }),
        )
        .toBe('dark/imperial');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally {
      // Keep the user-data folder: closing quits the app, which flushes the settings file.
      await first.app.close();
    }

    const stored = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as {
      general: { theme: string; units: string; startWithWindows: boolean };
    };
    expect(stored.general).toMatchObject({
      theme: 'dark',
      units: 'imperial',
      startWithWindows: true,
    });

    const second = await launchApp({ userData });
    try {
      const page = await openSettings(second.app);
      await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
      await expect(page.getByRole('radio', { name: 'Imperial' })).toBeChecked();
      await expect(page.getByRole('switch', { name: 'Start with Windows' })).toBeChecked();
    } finally {
      await second.close();
    }
  });

  test('rebinding a hotkey reports conflicts and applies a free combination', async () => {
    const launched = await launchApp();
    try {
      const page = await openSettings(launched.app, 'hotkeys');
      await expect(page.getByRole('heading', { name: 'Hotkeys', level: 1 })).toBeVisible();
      await expect(page.getByText('Ctrl+Shift+Space').first()).toBeVisible();
      // Assistant, Circle to Search, Capture Studio and Dictation each have their own row.
      await expect(page.getByRole('button', { name: 'Change', exact: true })).toHaveCount(4);

      // Assign the Circle hotkey to the assistant's combination: must be refused.
      const result = await page.evaluate(async () => {
        const bridge = (
          window as unknown as {
            beekeeper: {
              invoke: (
                channel: string,
                input: unknown,
              ) => Promise<{ ok: boolean; reason?: string }>;
            };
          }
        ).beekeeper;
        return bridge.invoke('hotkeys:set', { id: 'circle', accelerator: 'Ctrl+Shift+Space' });
      });
      expect(result.ok).toBe(false);

      // Some combinations may be taken by other apps on the machine running the test: try a few.
      const candidates = ['Ctrl+Alt+Shift+F8', 'Ctrl+Alt+Shift+F9', 'Ctrl+Alt+Shift+F10'];
      let applied: { ok: boolean; accelerator?: string } = { ok: false };
      for (const accelerator of candidates) {
        applied = await page.evaluate(async (candidate) => {
          const bridge = (
            window as unknown as {
              beekeeper: {
                invoke: (
                  channel: string,
                  input: unknown,
                ) => Promise<{ ok: boolean; accelerator?: string }>;
              };
            }
          ).beekeeper;
          return bridge.invoke('hotkeys:set', { id: 'circle', accelerator: candidate });
        }, accelerator);
        if (applied.ok) break;
      }
      expect(applied.ok).toBe(true);
      const stored = await launched.app.evaluate(() => {
        const hooks = (
          globalThis as unknown as {
            __beekeeper: { ctx: { settings: { get: () => { hotkeys: { circle: string } } } } };
          }
        ).__beekeeper;
        return hooks.ctx.settings.get().hotkeys.circle;
      });
      expect(stored).toBe(applied.accelerator);
    } finally {
      await launched.close();
    }
  });
});

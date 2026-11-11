import { expect, launchApp, openAssistant, pageFor, speechWav } from './fixtures';
import { test } from '@playwright/test';

test.describe('offline voice', () => {
  test.setTimeout(180_000);

  test('a spoken command is transcribed offline and answered', async () => {
    const launched = await launchApp({ model: true, fakeMic: speechWav('what time is it') });
    try {
      const page = await openAssistant(launched.app, { listen: true });
      await expect(page.locator('[data-card-kind="time"]')).toBeVisible({ timeout: 90_000 });
    } finally {
      await launched.close();
    }
  });

  test('"Hey Beekeeper" wakes the assistant when the wake word is on', async () => {
    const launched = await launchApp({
      model: true,
      fakeMic: speechWav('hey beekeeper'),
      settings: { voice: { ttsEnabled: false, earcons: false, wakeWord: true } },
    });
    try {
      const page = await pageFor(launched.app, 'assistant');
      await expect(page.getByRole('dialog', { name: 'Beekeeper assistant' })).toBeVisible({
        timeout: 90_000,
      });
    } finally {
      await launched.close();
    }
  });
});

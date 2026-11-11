import { expect, launchApp, openAssistant, pageFor, speechWav } from './fixtures';
import { test } from '@playwright/test';

/**
 * The fake microphone plays its file once from the moment the stream opens, so these tests are a
 * one-shot race against the start-up of the audio pipeline: two seconds of silence in front of the
 * words keep them safe on a busy machine, and one retry covers a freak stall.
 */
const LEAD_MS = 2000;

test.describe('offline voice', () => {
  test.setTimeout(180_000);
  test.describe.configure({ retries: 1 });

  test('a spoken command is transcribed offline and answered', async () => {
    const launched = await launchApp({
      model: true,
      fakeMic: speechWav('what time is it', LEAD_MS),
    });
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
      fakeMic: speechWav('hey beekeeper', LEAD_MS),
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

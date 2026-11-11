import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, openAssistant } from './fixtures';

/**
 * Real on-device speech: downloads the natural voice and Whisper (about 500 MB, verified against
 * pinned SHA-256 sums), then synthesises English and Hindi and recognises them again. Opt in with
 * BEEKEEPER_E2E_SPEECH=1. The packs are cached in node_modules/.cache so repeated runs are fast.
 */
test.skip(process.env['BEEKEEPER_E2E_SPEECH'] !== '1', 'Set BEEKEEPER_E2E_SPEECH=1 to run');
test.setTimeout(15 * 60_000);

const PACKS = ['supertonic-3', 'whisper-small'] as const;
const cache = join(process.cwd(), 'node_modules', '.cache', 'beekeeper', 'speech-packs');

function seedFromCache(userData: string): void {
  for (const pack of PACKS) {
    const source = join(cache, pack);
    if (existsSync(join(source, 'pack.json'))) {
      cpSync(source, join(userData, 'models', 'speech', pack), { recursive: true });
    }
  }
}

function saveToCache(userData: string): void {
  for (const pack of PACKS) {
    const source = join(userData, 'models', 'speech', pack);
    const target = join(cache, pack);
    if (!existsSync(join(source, 'pack.json')) || existsSync(join(target, 'pack.json'))) continue;
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) copyFileSync(join(source, name), join(target, name));
  }
}

interface SpeechHooks {
  features: {
    speech: {
      ensurePack: (id: string) => Promise<unknown>;
      status: () => {
        packs: Record<string, { state: string; message?: string }>;
        loaded: { tts: boolean; stt: string | null };
      };
      synthesize: (request: { text: string; lang: string }) => Promise<{
        format: string;
        sampleRate: number;
        data: ArrayBuffer;
        durationMs: number;
        lang: string;
      }>;
      transcribe: (request: { samples: Float32Array; language: string }) => Promise<{
        text: string;
        lang: string;
      }>;
    };
  };
}

test('downloads the speech packs, speaks English and Hindi and understands both', async () => {
  const launched = await launchApp({ settings: { voice: { ttsEnabled: true, earcons: false } } });
  const { app } = launched;
  try {
    mkdirSync(join(launched.userData, 'models', 'speech'), { recursive: true });
    seedFromCache(launched.userData);

    // The real downloader: resumable, hash-verified, extracted with the Windows tar.
    await app.evaluate(async () => {
      const { features } = (globalThis as unknown as { __beekeeper: SpeechHooks }).__beekeeper;
      await Promise.all(
        ['supertonic-3', 'whisper-small'].map((id) => features.speech.ensurePack(id)),
      );
    });
    await expect
      .poll(
        () =>
          app.evaluate(() => {
            const { features } = (globalThis as unknown as { __beekeeper: SpeechHooks })
              .__beekeeper;
            const { packs } = features.speech.status();
            const failed = Object.values(packs).find((pack) => pack.state === 'error');
            if (failed) return `error: ${failed.message ?? 'unknown'}`;
            return ['supertonic-3', 'whisper-small'].every((id) => packs[id]?.state === 'ready')
              ? 'ready'
              : 'downloading';
          }),
        { timeout: 12 * 60_000, intervals: [2000] },
      )
      .toBe('ready');
    saveToCache(launched.userData);

    const lines = await app.evaluate(async () => {
      const { features } = (globalThis as unknown as { __beekeeper: SpeechHooks }).__beekeeper;
      const out: Array<{
        text: string;
        lang: string;
        heard: string;
        heardLang: string;
        audioMs: number;
      }> = [];
      for (const text of ['Set a timer for five minutes.', 'आज मौसम कैसा है?']) {
        const voice = await features.speech.synthesize({ text, lang: 'auto' });
        const pcm = new Float32Array(voice.data);
        const ratio = voice.sampleRate / 16_000;
        const samples = new Float32Array(Math.floor(pcm.length / ratio));
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] = pcm[Math.floor(index * ratio)] ?? 0;
        }
        const heard = await features.speech.transcribe({ samples, language: 'auto' });
        out.push({
          text,
          lang: voice.lang,
          heard: heard.text,
          heardLang: heard.lang,
          audioMs: voice.durationMs,
        });
      }
      return out;
    });

    expect(lines[0]).toMatchObject({ lang: 'en', heardLang: 'en' });
    expect(lines[0]?.heard.toLowerCase()).toMatch(/timer.*(5|five) minutes/);
    expect(lines[1]).toMatchObject({ lang: 'hi', heardLang: 'hi' });
    expect(lines[1]?.heard).toMatch(/\u092e[\u094b\u094c]\u0938\u092e/); // "मौसम" or "मोसम"
    expect(lines.every((line) => line.audioMs > 500)).toBe(true);

    // The assistant window talks to the same engine over IPC (typed arrays and ArrayBuffers).
    const page = await openAssistant(app);
    const viaIpc = await page.evaluate(async () => {
      const bridge = (
        window as unknown as { beekeeper: { invoke: (c: string, i: unknown) => Promise<never> } }
      ).beekeeper;
      const voice = (await bridge.invoke('speech:synthesize', {
        text: 'Good morning! You have two reminders today.',
        lang: 'auto',
      })) as { format: string; data: ArrayBuffer; sampleRate: number };
      const pcm = new Float32Array(voice.data);
      const ratio = voice.sampleRate / 16_000;
      const samples = new Float32Array(Math.floor(pcm.length / ratio));
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = pcm[Math.floor(index * ratio)] ?? 0;
      }
      const heard = (await bridge.invoke('speech:transcribe', { samples })) as { text: string };
      const state = (await bridge.invoke('speech:status', undefined)) as {
        loaded: { tts: boolean; stt: string | null };
      };
      return {
        format: voice.format,
        bytes: voice.data.byteLength,
        heard: heard.text,
        loaded: state.loaded,
      };
    });
    expect(viaIpc.format).toBe('f32');
    expect(viaIpc.bytes).toBeGreaterThan(100_000);
    expect(viaIpc.heard.toLowerCase()).toContain('reminders');
    expect(viaIpc.loaded).toEqual({ tts: true, stt: 'small' });
  } finally {
    await launched.close();
  }
});

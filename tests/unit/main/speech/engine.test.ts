import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@shared/logger';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import type { SpeechPackId } from '@shared/speech/packs';
import { SPEECH_PACK_IDS } from '@shared/speech/packs';
import { SpeechEngine } from '@main/speech/engine';
import type { SpeechPackManager } from '@main/speech/packManager';
import type { ResultOf, WorkerRequestBody, WorkerResult } from '@main/speech/protocol';
import type { SpeechWorker } from '@main/speech/workerClient';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

class FakeWorker implements SpeechWorker {
  alive = true;
  readonly requests: WorkerRequestBody[] = [];
  constructor(
    private readonly handler: (body: WorkerRequestBody) => WorkerResult | Promise<WorkerResult>,
  ) {}
  async request<T extends WorkerResult['type']>(body: WorkerRequestBody): Promise<ResultOf<T>> {
    if (!this.alive) throw new Error('worker is gone');
    this.requests.push(body);
    return (await this.handler(body)) as ResultOf<T>;
  }
  terminate(): Promise<void> {
    this.alive = false;
    return Promise.resolve();
  }
}

function loudSamples(seconds: number, rate: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * rate));
  for (let index = 0; index < samples.length; index += 1) samples[index] = 0.3;
  return samples;
}

function defaultHandler(body: WorkerRequestBody): WorkerResult {
  switch (body.type) {
    case 'loadTts':
    case 'loadStt':
      return { type: 'loaded', ms: 5 };
    case 'synthesize': {
      const padded = new Float32Array(44_100 * 2);
      padded.set(loudSamples(1, 44_100), 44_100 / 2);
      return { type: 'synthesized', samples: padded, sampleRate: 44_100, ms: 10 };
    }
    case 'transcribe':
      return { type: 'transcribed', text: 'hello world', lang: 'en', ms: 20 };
  }
}

function fakePacks(ready: SpeechPackId[]) {
  const set = new Set(ready);
  const listeners = new Set<() => void>();
  const packs = {
    isReady: vi.fn((id: SpeechPackId) => set.has(id)),
    dir: vi.fn((id: SpeechPackId) => `C:\\models\\${id}`),
    status: vi.fn(() =>
      Object.fromEntries(
        SPEECH_PACK_IDS.map((id) => [
          id,
          {
            id,
            state: set.has(id) ? 'ready' : 'missing',
            receivedBytes: 0,
            totalBytes: 10,
            bytesPerSecond: 0,
            etaSeconds: null,
          },
        ]),
      ),
    ),
    onChange: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    ensure: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
    remove: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
  return { packs, set, listeners };
}

function setup(
  options: {
    ready?: SpeechPackId[];
    voice?: Partial<Settings['voice']>;
    handler?: (body: WorkerRequestBody) => WorkerResult | Promise<WorkerResult>;
    key?: string | null;
    fetch?: typeof fetch;
    idleMs?: number;
  } = {},
) {
  const { packs, set } = fakePacks(options.ready ?? ['supertonic-3', 'whisper-small']);
  const workers: FakeWorker[] = [];
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.voice, options.voice ?? {});
  const engine = new SpeechEngine({
    packs: packs as unknown as SpeechPackManager,
    createWorker: () => {
      const worker = new FakeWorker(options.handler ?? defaultHandler);
      workers.push(worker);
      return worker;
    },
    settings: () => settings,
    keys: { get: () => (options.key === undefined ? null : options.key) },
    fetch: options.fetch ?? (vi.fn()),
    logger,
    idleMs: options.idleMs ?? 1000,
    threads: 2,
  });
  return { engine, packs, set, workers, settings };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SpeechEngine.synthesize', () => {
  it('loads the voice once and returns trimmed float audio', async () => {
    const { engine, workers } = setup();
    const first = await engine.synthesize({ text: 'Good morning.', lang: 'auto' });
    const second = await engine.synthesize({ text: 'Good night.', lang: 'en' });

    expect(workers).toHaveLength(1);
    expect(workers[0]?.requests.map((request) => request.type)).toEqual([
      'loadTts',
      'synthesize',
      'synthesize',
    ]);
    expect(workers[0]?.requests[0]).toMatchObject({ dir: 'C:\\models\\supertonic-3', threads: 2 });
    expect(first).toMatchObject({
      format: 'f32',
      sampleRate: 44_100,
      engine: 'natural',
      lang: 'en',
    });
    // 2 s of audio with 1 s of speech in the middle is trimmed to about a second.
    expect(first.durationMs).toBeGreaterThan(1000);
    expect(first.durationMs).toBeLessThan(1300);
    expect(first.data.byteLength % 4).toBe(0);
    expect(first.data.byteLength / 4).toBeCloseTo((first.durationMs / 1000) * 44_100, -2);
    expect(second.engine).toBe('natural');
  });

  it('maps the chosen voice and speed to the model and detects Hindi', async () => {
    const { engine, workers } = setup({ voice: { naturalVoice: 'rohan', naturalSpeed: 1.2 } });
    const result = await engine.synthesize({ text: 'आज मौसम साफ़ है।', lang: 'auto' });
    expect(result.lang).toBe('hi');
    expect(workers[0]?.requests[1]).toMatchObject({
      type: 'synthesize',
      lang: 'hi',
      sid: 7,
      speed: 1.2,
    });

    await engine.synthesize({ text: 'Preview', lang: 'en', voice: 'asha', speed: 0.9 });
    expect(workers[0]?.requests[2]).toMatchObject({ sid: 0, speed: 0.9 });
  });

  it('cleans markdown before speaking', async () => {
    const { engine, workers } = setup();
    await engine.synthesize({ text: '**Sunny** at 23°C', lang: 'en' });
    expect(workers[0]?.requests[1]).toMatchObject({ text: 'Sunny at 23 degrees Celsius' });
  });

  it('says so when the natural voice is not installed', async () => {
    const { engine, workers } = setup({ ready: [] });
    await expect(engine.synthesize({ text: 'Hi there', lang: 'en' })).rejects.toThrow(
      /natural voice is not installed/,
    );
    expect(workers).toHaveLength(0);
  });

  it('refuses text with nothing to say', async () => {
    const { engine } = setup();
    await expect(engine.synthesize({ text: '  ** ', lang: 'en' })).rejects.toThrow(
      /nothing to say/,
    );
  });

  it('uses ElevenLabs when it is selected and configured', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Uint8Array(6400))));
    const { engine, workers } = setup({
      voice: { ttsEngine: 'elevenlabs', elevenLabsVoiceId: 'voice1' },
      key: 'sk-test',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await engine.synthesize({ text: 'Hello there', lang: 'en' });
    expect(result).toMatchObject({ format: 'mp3', engine: 'elevenlabs', durationMs: 800 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(0);
  });

  it('falls back to the natural voice when ElevenLabs has no key', async () => {
    const { engine } = setup({ voice: { ttsEngine: 'elevenlabs', elevenLabsVoiceId: 'voice1' } });
    const result = await engine.synthesize({ text: 'Hello there', lang: 'en' });
    expect(result.engine).toBe('natural');
  });

  it('turns a model that fails to load into a friendly error and stops the worker', async () => {
    const { engine, workers } = setup({
      handler: () => {
        throw new Error('onnxruntime exploded');
      },
    });
    await expect(engine.synthesize({ text: 'Hello there', lang: 'en' })).rejects.toThrow(
      /speech engine could not start/,
    );
    expect(workers[0]?.alive).toBe(false);
    expect(engine.status().engine).toBe('error');
    expect(engine.status().engineMessage).toMatch(/could not start/);

    // A later request starts a fresh worker.
    workers.length = 0;
    await expect(engine.synthesize({ text: 'Hello again', lang: 'en' })).rejects.toThrow();
    expect(workers).toHaveLength(1);
  });
});

describe('SpeechEngine.transcribe', () => {
  const speech = loudSamples(2, 16_000);

  it('detects the language when asked to and returns the text', async () => {
    const { engine, workers } = setup();
    const result = await engine.transcribe({ samples: new Float32Array(speech), language: 'auto' });
    expect(result).toMatchObject({
      text: 'hello world',
      lang: 'en',
      model: 'small',
      audioMs: 2000,
    });
    expect(workers[0]?.requests.map((request) => request.type)).toEqual(['loadStt', 'transcribe']);
    expect(workers[0]?.requests[1]).toMatchObject({ language: '' });
  });

  it('uses the language from settings when the request has none', async () => {
    const { engine, workers } = setup({ voice: { language: 'hi' } });
    await engine.transcribe({ samples: new Float32Array(speech) });
    expect(workers[0]?.requests[1]).toMatchObject({ language: 'hi' });
  });

  it('retries in English when detection picks a language Beekeeper does not serve', async () => {
    let calls = 0;
    const { engine, workers } = setup({
      handler: (body) => {
        if (body.type === 'loadStt') return { type: 'loaded', ms: 1 };
        calls += 1;
        return calls === 1
          ? { type: 'transcribed', text: 'اوپن کروم', lang: 'ur', ms: 5 }
          : { type: 'transcribed', text: 'open chrome', lang: 'en', ms: 5 };
      },
    });
    const result = await engine.transcribe({ samples: new Float32Array(speech), language: 'auto' });
    expect(result.text).toBe('open chrome');
    const languages = workers[0]?.requests
      .filter((request) => request.type === 'transcribe')
      .map((request) => (request as { language: string }).language);
    expect(languages).toEqual(['', 'en']);
  });

  it('keeps Hindi when detection finds it', async () => {
    const { engine } = setup({
      handler: (body) =>
        body.type === 'loadStt'
          ? { type: 'loaded', ms: 1 }
          : { type: 'transcribed', text: 'मौसम कैसा है', lang: 'hi', ms: 5 },
    });
    const result = await engine.transcribe({ samples: new Float32Array(speech), language: 'auto' });
    expect(result).toMatchObject({ text: 'मौसम कैसा है', lang: 'hi' });
  });

  it('decodes long recordings in chunks and joins the text', async () => {
    let part = 0;
    const { engine, workers } = setup({
      handler: (body) => {
        if (body.type === 'loadStt') return { type: 'loaded', ms: 1 };
        part += 1;
        return { type: 'transcribed', text: `part ${part}`, lang: 'en', ms: 5 };
      },
    });
    const result = await engine.transcribe({
      samples: loudSamples(60, 16_000),
      language: 'en',
    });
    expect(result.text).toBe('part 1 part 2 part 3');
    expect(workers[0]?.requests.filter((request) => request.type === 'transcribe')).toHaveLength(3);
  });

  it('uses the other Whisper model while the preferred one is missing', async () => {
    const { engine, workers } = setup({ ready: ['whisper-base'] });
    const result = await engine.transcribe({ samples: new Float32Array(speech) });
    expect(result.model).toBe('base');
    expect(workers[0]?.requests[0]).toMatchObject({ type: 'loadStt', size: 'base' });
  });

  it('says so when no recognition model is installed', async () => {
    const { engine } = setup({ ready: ['supertonic-3'] });
    await expect(engine.transcribe({ samples: new Float32Array(speech) })).rejects.toThrow(
      /recognition model is not installed/,
    );
  });

  it('swaps the model when the preferred size changes', async () => {
    const { engine, workers, settings } = setup({ ready: ['whisper-small', 'whisper-base'] });
    await engine.transcribe({ samples: new Float32Array(speech) });
    settings.voice.whisperModel = 'base';
    await engine.transcribe({ samples: new Float32Array(speech) });
    expect(workers).toHaveLength(2);
    expect(workers[0]?.alive).toBe(false);
    expect(workers[1]?.requests[0]).toMatchObject({ type: 'loadStt', size: 'base' });
  });
});

describe('SpeechEngine lifecycle', () => {
  const speech = loudSamples(1, 16_000);

  it('releases the models after the idle time and reloads on demand', async () => {
    const { engine, workers } = setup({ idleMs: 1000 });
    await engine.synthesize({ text: 'Hello there', lang: 'en' });
    expect(engine.status()).toMatchObject({ engine: 'ready', loaded: { tts: true } });

    await vi.advanceTimersByTimeAsync(1500);
    expect(workers[0]?.alive).toBe(false);
    expect(engine.status()).toMatchObject({ engine: 'idle', loaded: { tts: false, stt: null } });

    await engine.synthesize({ text: 'Hello again', lang: 'en' });
    expect(workers).toHaveLength(2);
  });

  it('keeps the models while requests keep coming', async () => {
    const { engine, workers } = setup({ idleMs: 1000 });
    await engine.synthesize({ text: 'One sentence.', lang: 'en' });
    await vi.advanceTimersByTimeAsync(700);
    await engine.synthesize({ text: 'Another one.', lang: 'en' });
    await vi.advanceTimersByTimeAsync(700);
    expect(workers[0]?.alive).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(workers[0]?.alive).toBe(false);
  });

  it('releases recognition and synthesis independently', async () => {
    const { engine, workers } = setup({ idleMs: 1000 });
    await engine.synthesize({ text: 'Hello there', lang: 'en' });
    await vi.advanceTimersByTimeAsync(600);
    await engine.transcribe({ samples: new Float32Array(speech) });
    await vi.advanceTimersByTimeAsync(600);
    expect(workers[0]?.alive).toBe(false); // voice idle for 1.2 s
    expect(workers[1]?.alive).toBe(true); // recognition used 0.6 s ago
  });

  it('preloads only what is installed', async () => {
    const { engine, workers } = setup({ ready: ['whisper-small'] });
    await engine.preload({ tts: true, stt: true });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.requests[0]).toMatchObject({ type: 'loadStt' });
  });

  it('pushes state changes to listeners', async () => {
    const { engine } = setup();
    const states: string[] = [];
    engine.onState((state) => states.push(state.engine));
    await engine.synthesize({ text: 'Hello there', lang: 'en' });
    expect(states).toContain('loading');
    expect(states.at(-1)).toBe('ready');
  });

  it('starts downloads without waiting for them', async () => {
    const { engine, packs } = setup();
    const state = await engine.ensurePack('whisper-base');
    expect(packs.ensure).toHaveBeenCalledWith('whisper-base');
    expect(state.packs['whisper-small'].state).toBe('ready');
    engine.cancelPack('whisper-base');
    expect(packs.cancel).toHaveBeenCalledWith('whisper-base');
  });

  it('stops the voice before its files are removed', async () => {
    const { engine, packs, workers } = setup();
    await engine.synthesize({ text: 'Hello there', lang: 'en' });
    await engine.removePack('supertonic-3');
    expect(workers[0]?.alive).toBe(false);
    expect(packs.remove).toHaveBeenCalledWith('supertonic-3');
  });

  it('terminates everything on dispose', async () => {
    const { engine, packs, workers } = setup();
    await engine.synthesize({ text: 'Hello there', lang: 'en' });
    await engine.transcribe({ samples: new Float32Array(speech) });
    await engine.dispose();
    expect(workers.every((worker) => !worker.alive)).toBe(true);
    expect(packs.dispose).toHaveBeenCalled();
  });
});

describe('SpeechEngine.testElevenLabs', () => {
  it('asks for the missing pieces first', async () => {
    const noKey = setup({ voice: { elevenLabsVoiceId: 'v' } });
    expect((await noKey.engine.testElevenLabs()).message).toMatch(/API key/);
    const noVoice = setup({ key: 'sk' });
    expect((await noVoice.engine.testElevenLabs()).message).toMatch(/voice ID/);
  });

  it('reports success and failure', async () => {
    const ok = vi.fn(() => Promise.resolve(new Response(new Uint8Array(100))));
    const good = setup({
      key: 'sk',
      voice: { elevenLabsVoiceId: 'v' },
      fetch: ok as unknown as typeof fetch,
    });
    expect(await good.engine.testElevenLabs()).toMatchObject({ ok: true });

    const denied = vi.fn(() => Promise.resolve(new Response(null, { status: 401 })));
    const bad = setup({
      key: 'sk',
      voice: { elevenLabsVoiceId: 'v' },
      fetch: denied as unknown as typeof fetch,
    });
    expect(await bad.engine.testElevenLabs()).toMatchObject({ ok: false });
    expect((await bad.engine.testElevenLabs()).message).toMatch(/rejected the API key/);
  });
});

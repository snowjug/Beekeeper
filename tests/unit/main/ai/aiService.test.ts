import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@shared/logger';
import { SettingsSchema, type Settings } from '@shared/settings';
import { AiService, buildMessages, buildVisionMessages } from '@main/ai/aiService';
import { AiError, type AzureOpenAiClient } from '@main/ai/azureOpenAi';

function settings(ai: Partial<Settings['ai']> = {}): Settings {
  return SettingsSchema.parse({ ai: { useAzureOpenAi: true, useAzureSpeech: true, ...ai } });
}

/** A fake client.stream: yields the items, then optionally throws. */
function streamOf(items: string[], error?: Error): () => AsyncGenerator<string> {
  return async function* () {
    await Promise.resolve();
    for (const item of items) yield item;
    if (error) throw error;
  };
}

function textOf(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function service(options: {
  ai?: Partial<Settings['ai']>;
  keys?: Partial<Record<'speech' | 'openai', string>>;
  env?: Record<string, string>;
  stream?: (...args: unknown[]) => AsyncGenerator<string>;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const test = vi.fn(() => Promise.resolve({ ok: true, message: 'ok' }));
  const client = {
    stream: options.stream ?? streamOf([]),
    test,
  } as unknown as AzureOpenAiClient;
  return {
    test,
    ai: new AiService({
      client,
      fetch: options.fetch ?? (() => Promise.reject(new Error('no network'))),
      settings: () => settings(options.ai),
      keys: { get: (name) => options.keys?.[name] ?? null },
      env: options.env ?? {},
      logger: silentLogger,
      ...(options.now ? { now: options.now } : {}),
    }),
  };
}

const FULL = {
  openAiEndpoint: 'https://example.openai.azure.com',
  openAiDeployment: 'gpt-4o',
};

describe('AiService configuration', () => {
  it('needs endpoint, deployment, key and the toggle', () => {
    expect(service({ ai: FULL, keys: { openai: 'k' } }).ai.isConfigured()).toBe(true);
    expect(service({ ai: FULL }).ai.isConfigured()).toBe(false);
    expect(
      service({ ai: { ...FULL, useAzureOpenAi: false }, keys: { openai: 'k' } }).ai.isConfigured(),
    ).toBe(false);
    expect(
      service({ ai: { openAiDeployment: 'x' }, keys: { openai: 'k' } }).ai.isConfigured(),
    ).toBe(false);
  });

  it('falls back to environment values for missing settings', () => {
    const { ai } = service({
      keys: { openai: 'k' },
      env: { openAiEndpoint: 'https://env.openai.azure.com', openAiDeployment: 'env-deploy' },
    });
    expect(ai.isConfigured()).toBe(true);
    expect(ai.openAiConfig()).toMatchObject({
      endpoint: 'https://env.openai.azure.com',
      deployment: 'env-deploy',
    });
    expect(ai.modelName()).toBe('env-deploy');
  });

  it('settings win over the environment', () => {
    const { ai } = service({
      ai: FULL,
      keys: { openai: 'k' },
      env: { openAiDeployment: 'env-deploy' },
    });
    expect(ai.modelName()).toBe('gpt-4o');
  });
});

describe('prompt building', () => {
  it('adds earlier requests as context', () => {
    const turns = [
      { id: '1', at: 1, text: "what's the weather", commandId: 'weather' },
      { id: '2', at: 2, text: 'what about tomorrow', commandId: 'weather' },
    ];
    const [system, user] = buildMessages('and the day after?', turns);
    expect(textOf(system?.content)).toContain('what about tomorrow');
    expect(user).toEqual({ role: 'user', content: 'and the day after?' });
    expect(textOf(buildMessages('hi', [])[0]?.content)).not.toContain('Earlier requests');
  });

  it('sends the circled image as a data URL with the question', () => {
    const [, user] = buildVisionMessages(Buffer.from('png'), '  what is this? ');
    const parts = user?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(parts[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(parts[1]?.image_url?.url).toBe(
      `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
    );
    const fallback = buildVisionMessages(Buffer.from('x'), undefined)[1]?.content as Array<{
      text?: string;
    }>;
    expect(fallback[0]?.text).toMatch(/What is this/);
  });
});

describe('AiService streaming', () => {
  it('emits deltas then done', async () => {
    const { ai } = service({
      ai: FULL,
      keys: { openai: 'k' },
      stream: streamOf(['Hel', 'lo']),
    });
    const events: unknown[] = [];
    await ai.stream({ cardId: 'c1', prompt: 'hi', turns: [] }, new AbortController().signal, (e) =>
      events.push(e),
    );
    expect(events).toEqual([
      { cardId: 'c1', delta: 'Hel' },
      { cardId: 'c1', delta: 'lo' },
      { cardId: 'c1', done: true },
    ]);
  });

  it('reports configuration and API failures as friendly errors', async () => {
    const unconfigured = service({});
    const events: unknown[] = [];
    await unconfigured.ai.stream(
      { cardId: 'c', prompt: 'x', turns: [] },
      new AbortController().signal,
      (e) => events.push(e),
    );
    expect(events[0]).toMatchObject({
      cardId: 'c',
      error: expect.stringContaining('Settings > AI') as string,
    });

    const failing = service({
      ai: FULL,
      keys: { openai: 'k' },
      stream: streamOf([], new AiError('auth', 'x')),
    });
    const failed: unknown[] = [];
    await failing.ai.stream(
      { cardId: 'c', prompt: 'x', turns: [] },
      new AbortController().signal,
      (e) => failed.push(e),
    );
    expect(failed[0]).toMatchObject({ error: expect.stringContaining('rejected') as string });
  });

  it('a cancelled stream finishes quietly', async () => {
    const { ai } = service({
      ai: FULL,
      keys: { openai: 'k' },
      stream: streamOf([], new AiError('aborted', 'x')),
    });
    const events: unknown[] = [];
    await ai.askAboutImage(
      { png: Buffer.from('x'), question: undefined, streamId: 's' },
      new AbortController().signal,
      (e) => events.push(e),
    );
    expect(events).toEqual([{ streamId: 's', done: true }]);
  });
});

describe('Azure Speech token', () => {
  const keys = { speech: 'speech-key-123' };

  it('issues and caches a token per key and region', async () => {
    let now = 1_000_000;
    const fetchMock = vi.fn(() => Promise.resolve(new Response('token-abc', { status: 200 })));
    const { ai } = service({
      ai: { speechRegion: 'westeurope' },
      keys,
      fetch: fetchMock,
      now: () => now,
    });
    const first = await ai.speechToken();
    expect(first).toMatchObject({ token: 'token-abc', region: 'westeurope' });
    await ai.speechToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://westeurope.api.cognitive.microsoft.com/sdk/token/issueToken');
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe(
      'speech-key-123',
    );
    now += 9 * 60_000;
    await ai.speechToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is off without the toggle, key or a valid region', async () => {
    expect(
      await service({
        ai: { useAzureSpeech: false, speechRegion: 'westeurope' },
        keys,
      }).ai.speechToken(),
    ).toBeNull();
    expect(await service({ ai: { speechRegion: 'westeurope' } }).ai.speechToken()).toBeNull();
    const bad = await service({ env: { speechRegion: 'west europe' }, keys }).ai.test('speech');
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/region/i);
  });

  it('test() explains rejected keys and network failures', async () => {
    const rejected = service({
      ai: { speechRegion: 'westeurope' },
      keys,
      fetch: () => Promise.resolve(new Response('', { status: 401 })),
    });
    expect((await rejected.ai.test('speech')).message).toMatch(/rejected/);
    const offline = service({ ai: { speechRegion: 'westeurope' }, keys });
    expect((await offline.ai.test('speech')).message).toMatch(/could not reach/i);
    const ok = service({
      ai: { speechRegion: 'westeurope' },
      keys,
      fetch: () => Promise.resolve(new Response('t', { status: 200 })),
    });
    expect(await ok.ai.test('speech')).toMatchObject({ ok: true });
  });

  it('test("openai") delegates to the client once configured', async () => {
    const { ai, test } = service({ ai: FULL, keys: { openai: 'k' } });
    expect(await ai.test('openai')).toEqual({ ok: true, message: 'ok' });
    expect(test).toHaveBeenCalledOnce();
    expect((await service({}).ai.test('openai')).ok).toBe(false);
  });
});

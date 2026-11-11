import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@shared/logger';
import {
  AiError,
  AzureOpenAiClient,
  buildChatUrl,
  deltaOf,
  describeAiError,
  errorFromStatus,
  readSse,
  type AzureOpenAiConfig,
} from '@main/ai/azureOpenAi';

const CONFIG: AzureOpenAiConfig = {
  endpoint: 'https://example.openai.azure.com/',
  deployment: 'gpt 4o',
  apiVersion: '2024-10-21',
  apiKey: 'secret-key-123',
};

function sse(...events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const chunk = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}

describe('buildChatUrl', () => {
  it('encodes the deployment and api-version and trims slashes', () => {
    expect(buildChatUrl(CONFIG)).toBe(
      'https://example.openai.azure.com/openai/deployments/gpt%204o/chat/completions?api-version=2024-10-21',
    );
  });
});

describe('readSse / deltaOf', () => {
  it('yields data payloads across chunk boundaries and stops at [DONE]', async () => {
    const response = sse(
      'data: {"a"',
      ':1}\n\ndata: second\r\n',
      '\n',
      'data: [DONE]\n\ndata: after\n\n',
    );
    expect(await collect(readSse(response.body as ReadableStream<Uint8Array>))).toEqual([
      '{"a":1}',
      'second',
    ]);
  });

  it('reads a final line without a trailing newline', async () => {
    const response = sse('data: last');
    expect(await collect(readSse(response.body as ReadableStream<Uint8Array>))).toEqual(['last']);
  });

  it('extracts content deltas and ignores filter / role chunks', () => {
    expect(deltaOf(JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }))).toBe('Hi');
    expect(deltaOf(JSON.stringify({ choices: [] }))).toBe('');
    expect(deltaOf(JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }))).toBe('');
    expect(deltaOf('not json')).toBe('');
  });

  it('turns an in-stream error into an AiError', () => {
    expect(() => deltaOf(JSON.stringify({ error: { code: 'content_filter' } }))).toThrow(AiError);
    expect(() => deltaOf(JSON.stringify({ error: { code: 'x' } }))).toThrow(AiError);
  });
});

describe('errorFromStatus', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [400, 'bad-request'],
    [500, 'server'],
  ] as const)('maps HTTP %i to %s', (status, kind) => {
    expect(errorFromStatus(status, '').kind).toBe(kind);
  });

  it('recognises content-filter rejections and never leaks the body', () => {
    const error = errorFromStatus(400, '{"error":{"code":"content_filter","secret":"sk-1"}}');
    expect(error.kind).toBe('content-filter');
    expect(error.message).not.toContain('sk-1');
    expect(describeAiError(error)).toBe(error.message);
    expect(describeAiError(new Error('boom'))).toMatch(/problem answering/);
  });
});

describe('AzureOpenAiClient', () => {
  it('streams text deltas and sends the key in the api-key header only', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(sse(chunk('Hel'), chunk('lo'), 'data: [DONE]\n\n')),
    );
    const client = new AzureOpenAiClient({
      fetch: fetchMock,
      logger: silentLogger,
    });
    const out = await collect(client.stream(CONFIG, [{ role: 'user', content: 'hi' }]));
    expect(out).toEqual(['Hel', 'lo']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/openai/deployments/gpt%204o/chat/completions');
    expect((init.headers as Record<string, string>)['api-key']).toBe('secret-key-123');
    expect(String(url)).not.toContain('secret-key');
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: true });
  });

  it('maps HTTP failures and network failures to friendly errors', async () => {
    const unauthorized = new AzureOpenAiClient({
      fetch: () => Promise.resolve(new Response('nope', { status: 401 })),
      logger: silentLogger,
    });
    await expect(collect(unauthorized.stream(CONFIG, []))).rejects.toMatchObject({ kind: 'auth' });

    const offline = new AzureOpenAiClient({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      logger: silentLogger,
    });
    await expect(collect(offline.stream(CONFIG, []))).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports an aborted request as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new AzureOpenAiClient({
      fetch: () => Promise.reject(new DOMException('x', 'AbortError')),
      logger: silentLogger,
    });
    await expect(collect(client.stream(CONFIG, [], controller.signal))).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('test() reports success with latency and failures without throwing', async () => {
    const ok = new AzureOpenAiClient({
      fetch: () => Promise.resolve(new Response('{}', { status: 200 })),
      logger: silentLogger,
    });
    const good = await ok.test(CONFIG);
    expect(good.ok).toBe(true);
    expect(good.message).toContain('gpt 4o');
    expect(good.latencyMs).toBeGreaterThanOrEqual(0);

    const missing = new AzureOpenAiClient({
      fetch: () => Promise.resolve(new Response('', { status: 404 })),
      logger: silentLogger,
    });
    expect(await missing.test(CONFIG)).toMatchObject({ ok: false });
  });
});

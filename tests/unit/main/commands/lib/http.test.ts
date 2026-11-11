import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpFailure, getJson } from '@main/commands/lib/http';

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init);
}

async function failure(promise: Promise<unknown>): Promise<HttpFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpFailure) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getJson', () => {
  it('returns the parsed body and asks for JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(json({ ok: true })));
    await expect(getJson(fetchFn, 'https://example.test/a', 1000)).resolves.toEqual({ ok: true });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ accept: 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports HTTP errors with their status', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(json({ message: 'no' }, { status: 404 })),
    );
    const error = await failure(getJson(fetchFn, 'https://example.test/a', 1000));
    expect(error).toMatchObject({ reason: 'status', status: 404, name: 'HttpFailure' });
  });

  it('reports network failures', async () => {
    const cause = new TypeError('fetch failed');
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(cause));
    const error = await failure(getJson(fetchFn, 'https://example.test/a', 1000));
    expect(error.reason).toBe('network');
    expect(error.cause).toBe(cause);
  });

  it('reports bodies that are not JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response('<html>')));
    const error = await failure(getJson(fetchFn, 'https://example.test/a', 1000));
    expect(error).toMatchObject({ reason: 'json', status: 200 });
  });

  it('gives up when the server never answers', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        }),
    );
    const pending = failure(getJson(fetchFn, 'https://example.test/a', 3000));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ reason: 'timeout' });
  });

  it('also covers a body that stalls', async () => {
    const fetchFn = vi.fn<typeof fetch>((_url, init) => {
      const stalled = {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
          }),
      };
      return Promise.resolve(stalled as unknown as Response);
    });
    const pending = failure(getJson(fetchFn, 'https://example.test/a', 3000));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ reason: 'timeout' });
  });

  it('does not leave a timer behind', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(json([])));
    await getJson(fetchFn, 'https://example.test/a', 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

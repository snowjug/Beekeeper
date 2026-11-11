import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadError, downloadVerified } from '@main/speech/download';

const DATA = Buffer.from(Array.from({ length: 5000 }, (_, index) => (index * 7) % 251));
const SHA = createHash('sha256').update(DATA).digest('hex');
const URL_OF_FILE = 'https://example.test/model.bin';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bk-download-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function streamOf(bytes: Buffer, chunk = 1000): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunk)));
      offset += chunk;
    },
  });
}

function serve(data: Buffer, options: { honourRange?: boolean } = {}): Handler {
  const honourRange = options.honourRange ?? true;
  return (_url, init) => {
    const range = (init.headers as Record<string, string> | undefined)?.['Range'];
    const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0;
    if (range && honourRange) {
      if (start >= data.length) return new Response(null, { status: 416 });
      return new Response(streamOf(data.subarray(start)), { status: 206 });
    }
    return new Response(streamOf(data), { status: 200 });
  };
}

function request(
  handler: Handler,
  overrides: Partial<Parameters<typeof downloadVerified>[0]> = {},
) {
  const progress: number[] = [];
  const fetchMock = vi.fn(handler);
  return {
    progress,
    fetchMock,
    run: () =>
      downloadVerified({
        url: URL_OF_FILE,
        target: join(dir, 'model.bin'),
        bytes: DATA.length,
        sha256: SHA,
        fetch: fetchMock as unknown as typeof fetch,
        signal: new AbortController().signal,
        onProgress: (received) => progress.push(received),
        backoffMs: () => 0,
        ...overrides,
      }),
  };
}

describe('downloadVerified', () => {
  it('downloads, verifies and renames the file', async () => {
    const { run, progress } = request(serve(DATA));
    await run();
    expect(await readFile(join(dir, 'model.bin'))).toEqual(DATA);
    await expect(stat(join(dir, 'model.bin.part'))).rejects.toThrow();
    expect(progress.at(-1)).toBe(DATA.length);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('resumes from a partial file with a Range request', async () => {
    await writeFile(join(dir, 'model.bin.part'), DATA.subarray(0, 2000));
    const { run, fetchMock, progress } = request(serve(DATA));
    await run();
    expect(await readFile(join(dir, 'model.bin'))).toEqual(DATA);
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['Range']).toBe('bytes=2000-');
    expect(progress[0]).toBe(2000);
  });

  it('starts over when the server ignores the Range header', async () => {
    await writeFile(join(dir, 'model.bin.part'), DATA.subarray(0, 2000));
    const { run } = request(serve(DATA, { honourRange: false }));
    await run();
    expect(await readFile(join(dir, 'model.bin'))).toEqual(DATA);
  });

  it('accepts a part file that is already complete (416)', async () => {
    await writeFile(join(dir, 'model.bin.part'), DATA);
    const { run } = request(serve(DATA));
    await run();
    expect(await readFile(join(dir, 'model.bin'))).toEqual(DATA);
  });

  it('retries a temporary server error', async () => {
    let calls = 0;
    const ok = serve(DATA);
    const { run } = request((url, init) => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : ok(url, init);
    });
    await run();
    expect(calls).toBe(2);
    expect(await readFile(join(dir, 'model.bin'))).toEqual(DATA);
  });

  it('retries after the connection drops', async () => {
    let calls = 0;
    const ok = serve(DATA);
    const { run } = request((url, init) => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return ok(url, init);
    });
    await run();
    expect(calls).toBe(2);
  });

  it('gives up on a permanent HTTP error', async () => {
    const { run, fetchMock } = request(() => new Response(null, { status: 404 }));
    await expect(run()).rejects.toMatchObject({ kind: 'http', retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discards a corrupt download and reports a checksum failure', async () => {
    const corrupt = Buffer.from(DATA);
    corrupt[10] = (corrupt[10] ?? 0) ^ 0xff;
    const { run } = request(serve(corrupt), { maxAttempts: 2 });
    await expect(run()).rejects.toMatchObject({ kind: 'integrity' });
    await expect(stat(join(dir, 'model.bin.part'))).rejects.toThrow();
    await expect(stat(join(dir, 'model.bin'))).rejects.toThrow();
  });

  it('retries a download that ends early and keeps what it got', async () => {
    let calls = 0;
    const ok = serve(DATA);
    const { run } = request((url, init) => {
      calls += 1;
      return calls === 1
        ? new Response(streamOf(DATA.subarray(0, 3000)), { status: 200 })
        : ok(url, init);
    });
    await run();
    expect(calls).toBe(2);
    expect(await readFile(join(dir, 'model.bin'))).toEqual(DATA);
  });

  it('stops on cancel without leaving a verified file', async () => {
    const controller = new AbortController();
    const { run } = request(
      (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new Uint8Array(100));
              init.signal?.addEventListener('abort', () => stream.error(new Error('aborted')));
              setTimeout(() => controller.abort(), 10);
            },
          }),
        ),
      { signal: controller.signal },
    );
    const failure = await run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DownloadError);
    expect(failure).toMatchObject({ kind: 'cancelled' });
    await expect(stat(join(dir, 'model.bin'))).rejects.toThrow();
  });

  it('treats a stalled connection as retryable', async () => {
    let calls = 0;
    const ok = serve(DATA);
    const { run } = request(
      (url, init) => {
        calls += 1;
        if (calls > 1) return ok(url, init);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              init.signal?.addEventListener('abort', () => stream.error(new Error('aborted')));
            },
          }),
        );
      },
      { stallTimeoutMs: 30 },
    );
    await run();
    expect(calls).toBe(2);
  });
});

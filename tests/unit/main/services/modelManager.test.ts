import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { open, rename } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeModelError,
  ModelManager,
  type ModelManagerOptions,
} from '@main/services/modelManager';
import type { Logger } from '@shared/logger';
import type { ModelManifest, ModelProgress } from '@shared/models';

// Pass-through wrappers so individual tests can inject disk errors; real I/O otherwise.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});

const FILE_NAME = 'test-model.tar.gz';
const SCRIPT = resolve('scripts', 'fetch-model.mjs');

function makePayload(size: number): Buffer {
  const blocks: Buffer[] = [];
  for (let index = 0; blocks.length * 32 < size; index += 1) {
    blocks.push(createHash('sha256').update(`beekeeper-model-${index}`).digest());
  }
  return Buffer.concat(blocks).subarray(0, size);
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

const PAYLOAD = makePayload(300_000);

function manifestFor(urls: string[], payload: Buffer = PAYLOAD): ModelManifest {
  return {
    id: 'test-model',
    displayName: 'Test model',
    description: 'Fixture archive',
    fileName: FILE_NAME,
    archiveRoot: 'test-model',
    urls,
    sha256: sha256(payload),
    sizeBytes: payload.length,
    license: 'MIT',
  };
}

let root: string;
let modelsDir: string;
const servers: Server[] = [];

const filePath = (): string => join(modelsDir, FILE_NAME);
const partPath = (): string => `${filePath()}.part`;
const markerPath = (): string => `${filePath()}.verified.json`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'beekeeper-models-'));
  modelsDir = join(root, 'models');
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
    ),
  );
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

interface TestServer {
  url: string;
  requests: { range: string | undefined }[];
}

type Responder = (req: IncomingMessage, res: ServerResponse, index: number) => void;

async function startServer(respond: Responder): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const server = createServer((req, res) => {
    requests.push({ range: req.headers.range });
    respond(req, res, requests.length - 1);
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/model.tar.gz`, requests };
}

/** A loopback URL whose port nothing listens on, so connecting to it is refused. */
async function unusedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', ready));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return `http://127.0.0.1:${port}/model.tar.gz`;
}

function sendFull(res: ServerResponse, data: Buffer = PAYLOAD): void {
  res.writeHead(200, {
    'Content-Length': data.length,
    'Content-Type': 'application/gzip',
    'Accept-Ranges': 'bytes',
  });
  res.end(data);
}

function sendRanged(req: IncomingMessage, res: ServerResponse, data: Buffer = PAYLOAD): void {
  const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
  if (!match) {
    sendFull(res, data);
    return;
  }
  const start = Number(match[1]);
  if (start >= data.length) {
    res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Length': data.length - start,
    'Content-Range': `bytes ${start}-${data.length - 1}/${data.length}`,
  });
  res.end(data.subarray(start));
}

function sendStatus(
  res: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, headers);
  res.end();
}

/** Announces the full length, sends `bytes` of it and then closes the connection. */
function dropAfter(res: ServerResponse, bytes: number): void {
  res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Accept-Ranges': 'bytes' });
  res.write(PAYLOAD.subarray(0, bytes), () => {
    setTimeout(() => res.destroy(), 30);
  });
}

/** Honours Range, sends `bytes` of the requested part and then closes the connection. */
function dropRangedAfter(req: IncomingMessage, res: ServerResponse, bytes: number): void {
  const requested = offsetOf(req.headers.range);
  const start = Number.isNaN(requested) ? 0 : requested;
  if (start > 0) {
    res.writeHead(206, {
      'Content-Length': PAYLOAD.length - start,
      'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
    });
  } else {
    res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Accept-Ranges': 'bytes' });
  }
  res.write(PAYLOAD.subarray(start, start + bytes), () => {
    setTimeout(() => res.destroy(), 30);
  });
}

/** Announces the full length, sends `bytes` of it and then never answers again. */
function hangAfter(res: ServerResponse, bytes: number): void {
  res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Accept-Ranges': 'bytes' });
  res.write(PAYLOAD.subarray(0, bytes));
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition');
    await new Promise((tick) => setTimeout(tick, 5));
  }
}

function steppingClock(stepMs: number): () => number {
  let now = 0;
  return () => {
    now += stepMs;
    return now;
  };
}

interface HarnessOptions extends Partial<ModelManagerOptions> {
  onSleep?: (ms: number) => void;
}

function createManager(manifest: ModelManifest, options: HarnessOptions = {}) {
  const { onSleep, ...rest } = options;
  const delays: number[] = [];
  const events: ModelProgress[] = [];
  const manager = new ModelManager({
    modelsDir,
    manifest,
    sleep: (ms) => {
      delays.push(ms);
      onSleep?.(ms);
      return Promise.resolve();
    },
    random: () => 0,
    ...rest,
  });
  manager.onProgress((event) => events.push(event));
  return { manager, delays, events };
}

function placeFile(content: Buffer): void {
  mkdirSync(modelsDir, { recursive: true });
  writeFileSync(filePath(), content);
}

function placePart(content: Buffer): void {
  mkdirSync(modelsDir, { recursive: true });
  writeFileSync(partPath(), content);
}

function flipByte(data: Buffer, index: number): Buffer {
  const copy = Buffer.from(data);
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
}

function offsetOf(range: string | undefined): number {
  return Number(/^bytes=(\d+)-$/.exec(range ?? '')?.[1] ?? Number.NaN);
}

describe('ModelManager.ensure: downloading', () => {
  it('downloads, verifies and publishes the archive', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager } = createManager(manifestFor([server.url]));
    expect(manager.getStatus()).toEqual({
      state: 'missing',
      receivedBytes: 0,
      totalBytes: PAYLOAD.length,
    });

    const status = await manager.ensure();

    expect(status).toEqual({
      state: 'ready',
      receivedBytes: PAYLOAD.length,
      totalBytes: PAYLOAD.length,
    });
    expect(manager.getFilePath()).toBe(filePath());
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
    expect(readdirSync(modelsDir).sort()).toEqual([FILE_NAME, `${FILE_NAME}.verified.json`]);
    expect(manager.isReady()).toBe(true);
    expect(manager.getStatus().state).toBe('ready');
    expect(server.requests).toEqual([{ range: undefined }]);
  });

  it('is idempotent once the archive is verified', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager, events } = createManager(manifestFor([server.url]));
    await manager.ensure();
    events.length = 0;

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests).toHaveLength(1);
    expect(events.map((event) => event.phase)).toEqual(['ready']);
    expect(events[0]?.receivedBytes).toBe(PAYLOAD.length);
  });

  it('reports phased progress with a smoothed speed and an ETA', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager, events } = createManager(manifestFor([server.url]), {
      now: steppingClock(150),
    });

    await manager.ensure();

    const phases = events.map((event) => event.phase);
    expect(phases[0]).toBe('checking');
    expect(phases.slice(-2)).toEqual(['verifying', 'ready']);
    const downloading = events.filter((event) => event.phase === 'downloading');
    expect(downloading.length).toBeGreaterThanOrEqual(2);
    const received = downloading.map((event) => event.receivedBytes);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(downloading.some((event) => event.bytesPerSecond > 0 && event.etaSeconds !== null)).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({
      phase: 'ready',
      receivedBytes: PAYLOAD.length,
      totalBytes: PAYLOAD.length,
      bytesPerSecond: 0,
      etaSeconds: null,
      attempt: 1,
      maxAttempts: 5,
    });
  });

  it('emits at most one chunk update per 100 ms', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager, events } = createManager(manifestFor([server.url]), { now: () => 5_000 });

    await manager.ensure();

    expect(events.map((event) => event.phase)).toEqual([
      'checking',
      'downloading',
      'verifying',
      'ready',
    ]);
  });

  it('keeps downloading when a progress listener throws', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const warn = vi.fn();
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const { manager } = createManager(manifestFor([server.url]), { logger });
    const off = manager.onProgress(() => {
      throw new Error('listener bug');
    });

    expect((await manager.ensure()).state).toBe('ready');
    expect(warn).toHaveBeenCalled();

    off();
  });

  it('stops notifying listeners that unsubscribed', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager } = createManager(manifestFor([server.url]));
    const seen = vi.fn();
    manager.onProgress(seen)();

    await manager.ensure();

    expect(seen).not.toHaveBeenCalled();
  });

  it('rejects manifests whose file name could escape the models folder', () => {
    const manifest = {
      ...manifestFor(['https://example.com/m.tar.gz']),
      fileName: '..\\evil.tar.gz',
    };
    expect(() => new ModelManager({ modelsDir, manifest })).toThrow('Invalid model manifest');
  });
});

describe('ModelManager.ensure: resuming', () => {
  it('resumes from the partial file after a mid-stream disconnect', async () => {
    const server = await startServer((req, res, index) => {
      if (index === 0) dropAfter(res, 150_000);
      else sendRanged(req, res);
    });
    let partialAtRetry = 0;
    const { manager, delays } = createManager(manifestFor([server.url]), {
      onSleep: () => {
        partialAtRetry = statSync(partPath()).size;
      },
    });

    const status = await manager.ensure();

    expect(status.state).toBe('ready');
    expect(partialAtRetry).toBeGreaterThan(0);
    expect(partialAtRetry).toBeLessThan(PAYLOAD.length);
    expect(server.requests[1]?.range).toBe(`bytes=${partialAtRetry}-`);
    expect(delays).toEqual([1000]);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
    expect(existsSync(partPath())).toBe(false);
  });

  it('resumes when the server ends the stream early without an error', async () => {
    const server = await startServer((req, res, index) => {
      if (index === 0) {
        res.writeHead(200, { 'Accept-Ranges': 'bytes' });
        res.end(PAYLOAD.subarray(0, 120_000));
      } else {
        sendRanged(req, res);
      }
    });
    const { manager } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests[1]?.range).toBe('bytes=120000-');
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it('does not use up its attempts while every drop still makes progress', async () => {
    const dropSizes = [120_000, 100_000, 70_000];
    const server = await startServer((req, res, index) => {
      const bytes = dropSizes[index];
      if (bytes === undefined) sendRanged(req, res);
      else dropRangedAfter(req, res, bytes);
    });
    const { manager, delays } = createManager(manifestFor([server.url]), { maxAttempts: 2 });

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests).toHaveLength(4);
    expect(delays).toEqual([1000, 1000, 1000]);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it('gives up when drops stop making meaningful progress', async () => {
    const server = await startServer((req, res) => dropRangedAfter(req, res, 1_000));
    const { manager, delays } = createManager(manifestFor([server.url]), { maxAttempts: 3 });

    const status = await manager.ensure();

    expect(status.state).toBe('error');
    expect(status.message).toBe('The download was interrupted — it will resume');
    expect(server.requests).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('starts over when the server ignores the Range header', async () => {
    const server = await startServer((_req, res, index) => {
      if (index === 0) dropAfter(res, 100_000);
      else sendFull(res);
    });
    const { manager } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests).toHaveLength(2);
    expect(offsetOf(server.requests[1]?.range)).toBeGreaterThan(0);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it.each<[string, Responder]>([
    [
      'answers 416 (range not satisfiable)',
      (req, res) => {
        if (req.headers.range)
          sendStatus(res, 416, { 'Content-Range': `bytes */${PAYLOAD.length}` });
        else sendFull(res);
      },
    ],
    [
      'answers 206 for a different range',
      (req, res) => {
        if (!req.headers.range) {
          sendFull(res);
          return;
        }
        res.writeHead(206, {
          'Content-Length': PAYLOAD.length,
          'Content-Range': `bytes 0-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
        });
        res.end(PAYLOAD);
      },
    ],
  ])('restarts from zero when the server %s', async (_name, rejectRange) => {
    const server = await startServer((req, res, index) => {
      if (index === 0) dropAfter(res, 100_000);
      else rejectRange(req, res, index);
    });
    const { manager, delays } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests).toHaveLength(3);
    expect(offsetOf(server.requests[1]?.range)).toBeGreaterThan(0);
    expect(server.requests[2]?.range).toBeUndefined();
    expect(delays).toHaveLength(1);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it('resumes from a partial file left by an earlier run', async () => {
    placePart(PAYLOAD.subarray(0, 120_000));
    const server = await startServer((req, res) => sendRanged(req, res));
    const { manager } = createManager(manifestFor([server.url]));
    expect(manager.getStatus()).toEqual({
      state: 'partial',
      receivedBytes: 120_000,
      totalBytes: PAYLOAD.length,
    });

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests.map((request) => request.range)).toEqual(['bytes=120000-']);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it('publishes a complete but unpublished partial file without any download', async () => {
    placePart(PAYLOAD);
    const fetchSpy = vi.fn<typeof fetch>();
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']), {
      fetch: fetchSpy,
    });

    expect((await manager.ensure()).state).toBe('ready');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(partPath())).toBe(false);
    expect(manager.isReady()).toBe(true);
  });

  it('discards a partial file that is larger than the archive', async () => {
    placePart(Buffer.concat([PAYLOAD, Buffer.alloc(10)]));
    const server = await startServer((req, res) => sendRanged(req, res));
    const { manager } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests.map((request) => request.range)).toEqual([undefined]);
  });

  it('recovers from a corrupt partial file by downloading everything again', async () => {
    placePart(flipByte(PAYLOAD, 1_000).subarray(0, 120_000));
    const server = await startServer((req, res) => sendRanged(req, res));
    const { manager, delays } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests.map((request) => request.range)).toEqual(['bytes=120000-', undefined]);
    expect(delays).toEqual([1000]);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });
});

describe('ModelManager.ensure: retrying and failing', () => {
  it('retries server errors with exponential backoff capped at 15 s', async () => {
    const server = await startServer((_req, res, index) => {
      if (index < 6) sendStatus(res, 500);
      else sendFull(res);
    });
    const { manager, delays } = createManager(manifestFor([server.url]), { maxAttempts: 7 });

    expect((await manager.ensure()).state).toBe('ready');

    expect(delays).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
    expect(server.requests).toHaveLength(7);
  });

  it('adds up to 25 % jitter to the backoff', async () => {
    const server = await startServer((_req, res, index) => {
      if (index === 0) sendStatus(res, 503);
      else sendFull(res);
    });
    const { manager, delays } = createManager(manifestFor([server.url]), { random: () => 1 });

    await manager.ensure();

    expect(delays).toEqual([1250]);
  });

  it.each([
    ['a number of seconds', '3', 3000],
    ['an HTTP date', new Date(Date.UTC(2030, 0, 1, 0, 0, 4)).toUTCString(), 4000],
    ['something unusable', 'soon', 1000],
  ])('honours Retry-After given as %s', async (_name, header, expectedDelay) => {
    const server = await startServer((_req, res, index) => {
      if (index === 0) sendStatus(res, 429, { 'Retry-After': header });
      else sendFull(res);
    });
    const { manager, delays } = createManager(manifestFor([server.url]), {
      now: () => Date.UTC(2030, 0, 1),
    });

    expect((await manager.ensure()).state).toBe('ready');

    expect(delays).toEqual([expectedDelay]);
  });

  it('moves on to the next source without retrying a permanent HTTP error', async () => {
    const missing = await startServer((_req, res) => sendStatus(res, 404));
    const mirror = await startServer((_req, res) => sendFull(res));
    const { manager, delays } = createManager(manifestFor([missing.url, mirror.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(missing.requests).toHaveLength(1);
    expect(mirror.requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('gives every source its full set of attempts before reporting an error', async () => {
    const first = await startServer((_req, res) => sendStatus(res, 500));
    const second = await startServer((_req, res) => sendStatus(res, 502));
    const error = vi.fn();
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error };
    const { manager, delays, events } = createManager(manifestFor([first.url, second.url]), {
      maxAttempts: 3,
      logger,
    });

    const status = await manager.ensure();

    expect(status).toEqual({
      state: 'error',
      receivedBytes: 0,
      totalBytes: PAYLOAD.length,
      message: 'The download server returned an error (HTTP 502)',
    });
    expect(first.requests).toHaveLength(3);
    expect(second.requests).toHaveLength(3);
    expect(delays).toEqual([1000, 2000, 1000, 2000]);
    expect(manager.getStatus()).toEqual(status);
    expect(manager.isReady()).toBe(false);
    expect(events.at(-1)).toMatchObject({ phase: 'error', message: status.message });
    expect(error).toHaveBeenCalled();
  });

  it('waits with real timers between attempts by default', async () => {
    const server = await startServer((_req, res, index) => {
      if (index === 0) sendStatus(res, 500);
      else sendFull(res);
    });
    const manager = new ModelManager({
      modelsDir,
      manifest: manifestFor([server.url]),
      random: () => 0,
    });
    const started = Date.now();

    expect((await manager.ensure()).state).toBe('ready');

    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it('announces the next attempt while waiting to retry', async () => {
    const server = await startServer((_req, res, index) => {
      if (index === 0) sendStatus(res, 500);
      else sendFull(res);
    });
    const { manager, events } = createManager(manifestFor([server.url]));

    await manager.ensure();

    const notice = events.find((event) => event.message !== undefined);
    expect(notice).toMatchObject({
      phase: 'downloading',
      attempt: 2,
      maxAttempts: 5,
      bytesPerSecond: 0,
      etaSeconds: null,
    });
  });

  it('reports a missing internet connection in plain words', async () => {
    const { manager, delays } = createManager(manifestFor([await unusedPortUrl()]), {
      maxAttempts: 2,
    });

    const status = await manager.ensure();

    expect(status.state).toBe('error');
    expect(status.message).toBe('No internet connection');
    expect(delays).toHaveLength(1);
  });

  it('retries unexpected failures of the injected fetch', async () => {
    const failing = vi.fn<typeof fetch>(() => Promise.reject(new Error('boom')));
    const { manager, delays } = createManager(manifestFor(['https://example.com/m.tar.gz']), {
      fetch: failing,
      maxAttempts: 3,
    });

    const status = await manager.ensure();

    expect(status.message).toBe('The speech model could not be downloaded (boom)');
    expect(failing).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2);
  });

  it('treats a response without a body as an interrupted download', async () => {
    const empty = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']), {
      fetch: empty,
      maxAttempts: 2,
    });

    const status = await manager.ensure();

    expect(status.message).toBe('The download was interrupted — it will resume');
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('aborts and retries a transfer that stalls', async () => {
    const server = await startServer((req, res, index) => {
      if (index === 0) hangAfter(res, 50_000);
      else sendRanged(req, res);
    });
    let partialAtRetry = 0;
    const { manager, delays } = createManager(manifestFor([server.url]), {
      stallTimeoutMs: 150,
      onSleep: () => {
        partialAtRetry = statSync(partPath()).size;
      },
    });

    expect((await manager.ensure()).state).toBe('ready');

    expect(partialAtRetry).toBeGreaterThan(0);
    expect(server.requests[1]?.range).toBe(`bytes=${partialAtRetry}-`);
    expect(delays).toEqual([1000]);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });
});

describe('ModelManager.ensure: integrity', () => {
  it('retries once after a checksum mismatch and then succeeds', async () => {
    const corrupt = flipByte(PAYLOAD, 1_000);
    const server = await startServer((_req, res, index) =>
      sendFull(res, index === 0 ? corrupt : PAYLOAD),
    );
    const { manager, delays, events } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.range).toBeUndefined();
    expect(delays).toEqual([1000]);
    expect(events.some((event) => event.message?.includes('checksum mismatch'))).toBe(true);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
    expect(existsSync(partPath())).toBe(false);
  });

  it('gives up on a source that keeps serving corrupt data and leaves nothing behind', async () => {
    const corrupt = flipByte(PAYLOAD, 5);
    const server = await startServer((_req, res) => sendFull(res, corrupt));
    const { manager } = createManager(manifestFor([server.url]), { maxAttempts: 2 });

    const status = await manager.ensure();

    expect(status.state).toBe('error');
    expect(status.message).toBe('The downloaded file is corrupt (checksum mismatch)');
    expect(server.requests).toHaveLength(2);
    expect(existsSync(filePath())).toBe(false);
    expect(existsSync(partPath())).toBe(false);
  });

  it('rejects a response whose announced length differs from the manifest before downloading', async () => {
    const server = await startServer((_req, res) => sendFull(res, PAYLOAD.subarray(0, 1_000)));
    const { manager } = createManager(manifestFor([server.url]), { maxAttempts: 1 });

    const status = await manager.ensure();

    expect(status.message).toBe('The downloaded file is corrupt (checksum mismatch)');
    expect(existsSync(partPath())).toBe(false);
  });

  it('rejects a server that sends more data than the manifest allows', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(Buffer.concat([PAYLOAD, Buffer.alloc(64, 1)]));
    });
    const { manager } = createManager(manifestFor([server.url]), { maxAttempts: 1 });

    const status = await manager.ensure();

    expect(status.state).toBe('error');
    expect(status.message).toBe('The downloaded file is corrupt (checksum mismatch)');
    expect(existsSync(filePath())).toBe(false);
  });
});

describe('ModelManager.ensure: disk problems', () => {
  it('does not retry when the disk is full', async () => {
    const real = await vi.importActual<typeof FsPromises>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
      const handle = await real.open(path, flags, mode);
      const full = Object.assign(new Error('ENOSPC: no space left on device, write'), {
        code: 'ENOSPC',
      });
      vi.spyOn(handle, 'write').mockRejectedValue(full);
      return handle;
    });
    const server = await startServer((_req, res) => sendFull(res));
    const { manager, delays } = createManager(manifestFor([server.url]));

    const status = await manager.ensure();

    expect(status).toMatchObject({ state: 'error', message: 'Not enough disk space' });
    expect(server.requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('does not retry when the models folder is not writable', async () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
      path: partPath(),
    });
    vi.mocked(open).mockRejectedValueOnce(denied);
    const server = await startServer((_req, res) => sendFull(res));
    const { manager, delays } = createManager(manifestFor([server.url]));

    const status = await manager.ensure();

    expect(status.state).toBe('error');
    expect(status.message).toBe(`Permission denied writing to ${partPath()}`);
    expect(server.requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('retries the final rename while Windows keeps the file locked', async () => {
    const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    vi.mocked(rename).mockRejectedValueOnce(busy).mockRejectedValueOnce(busy);
    const server = await startServer((_req, res) => sendFull(res));
    const { manager, delays } = createManager(manifestFor([server.url]));

    expect((await manager.ensure()).state).toBe('ready');

    expect(delays).toEqual([40, 80]);
  });

  it('reports a rename that never succeeds and publishes the file on the next run', async () => {
    const locked = Object.assign(new Error('EPERM: operation not permitted'), {
      code: 'EPERM',
      path: partPath(),
    });
    for (let index = 0; index < 6; index += 1) vi.mocked(rename).mockRejectedValueOnce(locked);
    const server = await startServer((_req, res) => sendFull(res));
    const { manager } = createManager(manifestFor([server.url]));

    const failed = await manager.ensure();

    expect(failed.message).toBe(`Permission denied writing to ${partPath()}`);
    expect(statSync(partPath()).size).toBe(PAYLOAD.length);

    expect((await manager.ensure()).state).toBe('ready');
    expect(server.requests).toHaveLength(1);
  });
});

describe('ModelManager.ensure: cancelling and sharing', () => {
  it('stops on abort, keeps the partial file and resumes on the next call', async () => {
    const server = await startServer((req, res, index) => {
      if (index === 0) hangAfter(res, 100_000);
      else sendRanged(req, res);
    });
    const { manager, events } = createManager(manifestFor([server.url]), {
      now: steppingClock(150),
    });
    const controller = new AbortController();

    const stopped = await manager.ensure({
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'downloading' && progress.receivedBytes > 0) controller.abort();
      },
    });

    expect(stopped.state).toBe('partial');
    expect(stopped.receivedBytes).toBeGreaterThan(0);
    expect(manager.getStatus().state).toBe('partial');

    expect((await manager.ensure()).state).toBe('ready');
    expect(server.requests).toHaveLength(2);
    expect(offsetOf(server.requests[1]?.range)).toBeGreaterThan(0);
    expect(
      events.some((event) => event.phase === 'error' && /cancelled/.test(event.message ?? '')),
    ).toBe(true);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it('cancel() ends the download with a resumable partial status', async () => {
    const server = await startServer((_req, res) => hangAfter(res, 100_000));
    const { manager, events } = createManager(manifestFor([server.url]), {
      now: steppingClock(150),
    });

    const stopped = await manager.ensure({
      onProgress: (progress) => {
        if (progress.phase === 'downloading' && progress.receivedBytes > 0) manager.cancel();
      },
    });

    expect(stopped.state).toBe('partial');
    expect(manager.getStatus().state).toBe('partial');
    expect(events.at(-1)).toMatchObject({
      phase: 'error',
      message: 'The download was cancelled — it will resume next time',
    });
  });

  it('can be cancelled while waiting to retry', async () => {
    const server = await startServer((_req, res) => sendStatus(res, 500));
    const controller = new AbortController();
    const { manager } = createManager(manifestFor([server.url]), {
      sleep: () => new Promise<void>(() => undefined),
    });

    const stopped = await manager.ensure({
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.message !== undefined) controller.abort();
      },
    });

    expect(stopped.state).toBe('missing');
    expect(server.requests).toHaveLength(1);
  });

  it('returns immediately for a signal that is already aborted', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']), {
      fetch: fetchSpy,
    });

    const status = await manager.ensure({ signal: AbortSignal.abort() });

    expect(status.state).toBe('missing');
    expect(fetchSpy).not.toHaveBeenCalled();
    manager.cancel();
  });

  it('lets concurrent callers share a single download', async () => {
    const server = await startServer((_req, res) => {
      setTimeout(() => sendFull(res), 60);
    });
    const { manager } = createManager(manifestFor([server.url]));
    const firstEvents: ModelProgress[] = [];
    const secondEvents: ModelProgress[] = [];

    const first = manager.ensure({ onProgress: (event) => firstEvents.push(event) });
    expect(manager.getStatus().state).toBe('downloading');
    const second = manager.ensure({ onProgress: (event) => secondEvents.push(event) });
    const third = Promise.resolve().then(() => manager.ensure());
    const results = await Promise.all([first, second, third]);

    expect(server.requests).toHaveLength(1);
    expect(results.map((result) => result.state)).toEqual(['ready', 'ready', 'ready']);
    expect(firstEvents.at(-1)?.phase).toBe('ready');
    expect(secondEvents.at(-1)?.phase).toBe('ready');
  });

  it('keeps downloading while another caller is still waiting', async () => {
    const server = await startServer((_req, res) => {
      setTimeout(() => sendFull(res), 60);
    });
    const { manager } = createManager(manifestFor([server.url]));
    const controller = new AbortController();

    const leaving = manager.ensure({ signal: controller.signal });
    const staying = manager.ensure();
    controller.abort();

    expect((await leaving).state).toBe('missing');
    expect((await staying).state).toBe('ready');
    expect(server.requests).toHaveLength(1);
  });

  it('cancel() does nothing when no download is running', () => {
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']));
    expect(() => manager.cancel()).not.toThrow();
    expect(manager.getStatus().state).toBe('missing');
  });
});

describe('ModelManager.isReady', () => {
  it('verifies an unmarked complete file once and trusts its marker afterwards', async () => {
    placeFile(PAYLOAD);
    const fetchSpy = vi.fn<typeof fetch>();
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']), {
      fetch: fetchSpy,
    });
    expect(manager.isReady()).toBe(false);
    expect(manager.getStatus().state).toBe('missing');

    expect((await manager.ensure()).state).toBe('ready');

    expect(manager.isReady()).toBe(true);
    expect(JSON.parse(readFileSync(markerPath(), 'utf8'))).toEqual({
      sha256: sha256(PAYLOAD),
      sizeBytes: PAYLOAD.length,
      mtimeMs: statSync(filePath()).mtimeMs,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is invalidated when the file is touched and re-verified without downloading', async () => {
    placeFile(PAYLOAD);
    const fetchSpy = vi.fn<typeof fetch>();
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']), {
      fetch: fetchSpy,
    });
    await manager.ensure();

    const later = new Date(Date.now() + 60_000);
    utimesSync(filePath(), later, later);
    expect(manager.isReady()).toBe(false);

    expect((await manager.ensure()).state).toBe('ready');
    expect(manager.isReady()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each<[string, (current: Buffer) => Buffer]>([
    ['changes content but keeps the size', (current) => flipByte(current, 7)],
    ['is truncated', (current) => current.subarray(0, 1_000)],
  ])('downloads again when the file %s', async (_name, damage) => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager } = createManager(manifestFor([server.url]));
    await manager.ensure();

    writeFileSync(filePath(), damage(PAYLOAD));
    const later = new Date(Date.now() + 60_000);
    utimesSync(filePath(), later, later);
    expect(manager.isReady()).toBe(false);

    expect((await manager.ensure()).state).toBe('ready');
    expect(server.requests).toHaveLength(2);
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
  });

  it.each<[string, string]>([
    [
      'another checksum',
      JSON.stringify({ sha256: 'f'.repeat(64), sizeBytes: 300_000, mtimeMs: 1 }),
    ],
    ['another size', JSON.stringify({ sha256: sha256(PAYLOAD), sizeBytes: 1, mtimeMs: 1 })],
    ['incomplete data', JSON.stringify({ sha256: sha256(PAYLOAD) })],
    ['no JSON at all', '{ not json'],
  ])('is not ready when the marker holds %s', (_name, content) => {
    placeFile(PAYLOAD);
    writeFileSync(markerPath(), content, 'utf8');
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']));

    expect(manager.isReady()).toBe(false);
  });

  it('is not ready without the archive even if a marker exists', () => {
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(markerPath(), '{}', 'utf8');
    const { manager } = createManager(manifestFor(['https://example.com/m.tar.gz']));

    expect(manager.isReady()).toBe(false);
  });
});

describe('ModelManager.remove', () => {
  it('deletes the archive, the partial file and the marker', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const { manager } = createManager(manifestFor([server.url]));
    await manager.ensure();
    placePart(PAYLOAD.subarray(0, 10));

    await manager.remove();

    expect(readdirSync(modelsDir)).toEqual([]);
    expect(manager.getStatus().state).toBe('missing');
    expect(manager.isReady()).toBe(false);
  });

  it('cancels a running download before deleting its files', async () => {
    const server = await startServer((_req, res) => hangAfter(res, 100_000));
    const { manager } = createManager(manifestFor([server.url]));
    const running = manager.ensure();
    await waitFor(() => existsSync(partPath()) && statSync(partPath()).size > 0);

    await manager.remove();

    expect((await running).state).not.toBe('ready');
    expect(readdirSync(modelsDir)).toEqual([]);
    expect(manager.getStatus().state).toBe('missing');
  });

  it('forgets an earlier failure', async () => {
    const server = await startServer((_req, res) => sendStatus(res, 404));
    const { manager } = createManager(manifestFor([server.url]));
    expect((await manager.ensure()).state).toBe('error');

    await manager.remove();

    expect(manager.getStatus().state).toBe('missing');
  });
});

describe('describeModelError', () => {
  const withCode = (code: string, extra: Record<string, unknown> = {}): Error =>
    Object.assign(new Error(`${code}: failure`), { code, ...extra });
  const fetchFailed = (cause: unknown): TypeError => new TypeError('fetch failed', { cause });

  it.each<[string, unknown, string]>([
    ['a full disk', withCode('ENOSPC', { path: 'C:\\m' }), 'Not enough disk space'],
    ['an exceeded quota', withCode('EDQUOT'), 'Not enough disk space'],
    [
      'a protected folder',
      withCode('EACCES', { path: 'C:\\models\\m.part' }),
      'Permission denied writing to C:\\models\\m.part',
    ],
    ['a missing DNS entry', fetchFailed(withCode('ENOTFOUND')), 'No internet connection'],
    ['a refused connection', fetchFailed(withCode('ECONNREFUSED')), 'No internet connection'],
    [
      'Electron offline error',
      new TypeError('net::ERR_INTERNET_DISCONNECTED'),
      'No internet connection',
    ],
    [
      'a reset socket',
      new TypeError('terminated', { cause: withCode('UND_ERR_SOCKET') }),
      'The download was interrupted — it will resume',
    ],
    ['a reset connection', withCode('ECONNRESET'), 'The download was interrupted — it will resume'],
    [
      'Electron reset error',
      new TypeError('net::ERR_CONNECTION_RESET'),
      'The download was interrupted — it will resume',
    ],
    [
      'a terminated body',
      new TypeError('terminated'),
      'The download was interrupted — it will resume',
    ],
    ['any other error', new Error('boom'), 'The speech model could not be downloaded (boom)'],
    [
      'a socket permission error',
      withCode('EACCES'),
      'The speech model could not be downloaded (EACCES: failure)',
    ],
    ['a plain string', 'bad thing', 'The speech model could not be downloaded (bad thing)'],
    ['nothing', undefined, 'The speech model could not be downloaded (Unknown error)'],
  ])('explains %s', (_name, error, expected) => {
    expect(describeModelError(error)).toBe(expected);
  });
});

interface ScriptRun {
  code: number;
  output: string;
}

function runScript(args: string[]): Promise<ScriptRun> {
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { timeout: 30_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      done({ code, output: `${stdout}${stderr}` });
    });
  });
}

describe('scripts/fetch-model.mjs', () => {
  function writeManifest(manifest: ModelManifest): string[] {
    const manifestPath = join(root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    return ['--manifest', manifestPath, '--dir', modelsDir];
  }

  it('downloads the model and leaves a file the app accepts as ready', async () => {
    const server = await startServer((_req, res) => sendFull(res));
    const manifest = manifestFor([server.url]);
    const args = writeManifest(manifest);

    const first = await runScript(args);

    expect(first.code).toBe(0);
    expect(first.output).toContain('verified');
    expect(readFileSync(filePath()).equals(PAYLOAD)).toBe(true);
    expect(new ModelManager({ modelsDir, manifest }).isReady()).toBe(true);

    const second = await runScript(args);
    expect(second.code).toBe(0);
    expect(second.output).toContain('already present and verified');
    expect(server.requests).toHaveLength(1);
  });

  it('resumes a partial download', async () => {
    placePart(PAYLOAD.subarray(0, 100_000));
    const server = await startServer((req, res) => sendRanged(req, res));
    const manifest = manifestFor([server.url]);

    const run = await runScript(writeManifest(manifest));

    expect(run.code).toBe(0);
    expect(run.output).toContain('Resuming from');
    expect(server.requests.map((request) => request.range)).toEqual(['bytes=100000-']);
    expect(new ModelManager({ modelsDir, manifest }).isReady()).toBe(true);
  });

  it('starts over when the server ignores the resume request', async () => {
    placePart(PAYLOAD.subarray(0, 100_000));
    const server = await startServer((_req, res) => sendFull(res));
    const manifest = manifestFor([server.url]);

    const run = await runScript(writeManifest(manifest));

    expect(run.code).toBe(0);
    expect(run.output).toContain('ignored the resume request');
    expect(new ModelManager({ modelsDir, manifest }).isReady()).toBe(true);
  });

  it('exits with 1 and says why when no source works', async () => {
    const server = await startServer((_req, res) => sendStatus(res, 404));

    const run = await runScript(writeManifest(manifestFor([server.url])));

    expect(run.code).toBe(1);
    expect(run.output).toContain('HTTP 404');
    expect(existsSync(filePath())).toBe(false);
  });
});

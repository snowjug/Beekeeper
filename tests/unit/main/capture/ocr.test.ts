import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import {
  OcrError,
  createOcrService,
  type OcrService,
  type OcrServiceOptions,
  type OcrWorker,
  type OcrWorkerFactory,
} from '@main/capture/ocr';
import { OCR_ASAR_UNPACK, resolveOcrAssets, unpackAsarPath } from '@main/capture/ocr-assets';
import type { Rect } from '@shared/geometry';
import { silentLogger, type Logger } from '@shared/logger';

const nodeRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function fakePng(width = 100, height = 50): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function fakeJpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 and a SOF0 frame header whose size fields are filled in below, EOI
  const bytes = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02,
    0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

type WordSpec = [
  text: string,
  confidence: number,
  box: [x0: number, y0: number, x1: number, y1: number],
];

/** tesseract.js page output (blocks > paragraphs > lines > words) with one block and one paragraph. */
function page(...lines: WordSpec[][]): unknown {
  return {
    blocks: [
      {
        paragraphs: [
          {
            lines: lines.map((words) => ({
              words: words.map(([text, confidence, [x0, y0, x1, y1]]) => ({
                text,
                confidence,
                bbox: { x0, y0, x1, y1 },
              })),
            })),
          },
        ],
      },
    ],
  };
}

const HELLO_PAGE = page([['Hello', 96, [10, 10, 60, 30]]]);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function spyLogger(): { logger: Logger; spies: Record<keyof Logger, Mock> } {
  const spies = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger: Logger = {
    debug: (...args) => {
      spies.debug(...args);
    },
    info: (...args) => {
      spies.info(...args);
    },
    warn: (...args) => {
      spies.warn(...args);
    },
    error: (...args) => {
      spies.error(...args);
    },
  };
  return { logger, spies };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------------------------
// Fake worker (unit tests of the service logic)
// ---------------------------------------------------------------------------------------------

interface FakeCall {
  image: Uint8Array;
  rectangle: Rect | undefined;
}

type FakeHandler = (call: FakeCall, worker: FakeWorker) => Promise<unknown>;

class FakeWorker implements OcrWorker {
  readonly calls: FakeCall[] = [];
  terminated = 0;
  terminateError: Error | null = null;
  private readonly crashListeners: Array<(error: Error) => void> = [];

  constructor(private readonly handler: FakeHandler) {}

  recognize(image: Uint8Array, rectangle?: Rect): Promise<unknown> {
    const call = { image, rectangle };
    this.calls.push(call);
    return this.handler(call, this);
  }

  terminate(): Promise<void> {
    this.terminated += 1;
    return this.terminateError ? Promise.reject(this.terminateError) : Promise.resolve();
  }

  onCrash(listener: (error: Error) => void): void {
    this.crashListeners.push(listener);
  }

  crash(message = 'worker thread died'): void {
    for (const listener of this.crashListeners) listener(new Error(message));
  }
}

function harness(
  handler: FakeHandler = () => Promise.resolve(HELLO_PAGE),
  options: Partial<OcrServiceOptions> = {},
): { service: OcrService; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const workerFactory: OcrWorkerFactory = () => {
    const worker = new FakeWorker(handler);
    workers.push(worker);
    return Promise.resolve(worker);
  };
  const service = createOcrService({
    langPath: 'lang',
    cachePath: 'cache',
    logger: silentLogger,
    workerFactory,
    ...options,
  });
  return { service, workers };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------
// Result normalisation
// ---------------------------------------------------------------------------------------------

describe('result normalisation', () => {
  async function run(
    output: unknown,
    options: Partial<OcrServiceOptions> = {},
    image = fakePng(200, 100),
  ) {
    const { service } = harness(() => Promise.resolve(output), options);
    return service.recognize(image);
  }

  it('builds lines and words in reading order with image pixel boxes', async () => {
    const result = await run(
      page(
        [
          ['Hello', 96, [10, 10, 60, 30]],
          ['world', 90, [70, 12, 120, 34]],
        ],
        [['Second', 95, [10, 50, 70, 70]]],
      ),
    );
    expect(result.text).toBe('Hello world\nSecond');
    expect(result.lines.map((line) => line.text)).toEqual(['Hello world', 'Second']);
    expect(result.lines[0]?.bbox).toEqual({ x: 10, y: 10, width: 110, height: 24 });
    expect(result.words.map((word) => [word.text, word.lineIndex])).toEqual([
      ['Hello', 0],
      ['world', 0],
      ['Second', 1],
    ]);
    expect(result.words[1]?.bbox).toEqual({ x: 70, y: 12, width: 50, height: 22 });
    expect(result.lines[0]?.words).toEqual([result.words[0], result.words[1]]);
    expect(result.lines.map((line) => line.confidence)).toEqual([93, 95]);
    expect(result.confidence).toBe(93.8);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it('drops noise words and re-indexes the lines that are left', async () => {
    const result = await run(
      page(
        [['junk', 10, [1, 1, 20, 10]]],
        [
          ['Real', 90, [10, 30, 50, 50]],
          ['x', 5, [60, 30, 70, 50]],
        ],
      ),
    );
    expect(result.lines.map((line) => line.text)).toEqual(['Real']);
    expect(result.words.map((word) => [word.text, word.lineIndex])).toEqual([['Real', 0]]);
  });

  it('keeps what the confidence limit allows', async () => {
    const output = page([
      ['low', 10, [1, 1, 20, 10]],
      ['mid', 60, [30, 1, 50, 10]],
      ['top', 97, [60, 1, 80, 10]],
    ]);
    expect((await run(output, { minWordConfidence: 0 })).words).toHaveLength(3);
    expect((await run(output)).words.map((word) => word.text)).toEqual(['mid', 'top']);
    expect((await run(output, { minWordConfidence: 95 })).words.map((word) => word.text)).toEqual([
      'top',
    ]);
  });

  it('clamps boxes to the image and drops words without a usable box', async () => {
    const result = await run(
      page([
        ['left', 90, [-10, -5, 50, 30]],
        ['right', 90, [190, 90, 260, 140]],
        ['outside', 90, [300, 300, 310, 310]],
        ['flat', 90, [50, 50, 50, 60]],
        ['reversed', 90, [120, 80, 100, 60]],
      ]),
    );
    expect(result.words.map((word) => [word.text, word.bbox])).toEqual([
      ['left', { x: 0, y: 0, width: 50, height: 30 }],
      ['right', { x: 190, y: 90, width: 10, height: 10 }],
      ['reversed', { x: 100, y: 60, width: 20, height: 20 }],
    ]);
  });

  it('cleans word text and limits confidence to 0-100', async () => {
    const result = await run(
      page([
        ['  Hel\u0000lo\t\n ', 150, [10, 10, 60, 30]],
        ['\ufffd', 90, [70, 10, 80, 30]],
        ['neg', -20, [90, 10, 110, 30]],
      ]),
      { minWordConfidence: 0 },
    );
    expect(result.words.map((word) => [word.text, word.confidence])).toEqual([
      ['Hel lo', 100],
      ['neg', 0],
    ]);
    expect(result.text).toBe('Hel lo neg');
  });

  it('always reports numbers, whatever the worker returned', async () => {
    const messy = {
      blocks: [
        null,
        { paragraphs: null },
        {
          paragraphs: [
            {
              lines: [
                { words: [{ text: 'ok', confidence: '90', bbox: { x0: 1, y0: 1, x1: 9, y1: 9 } }] },
                {
                  words: [
                    { text: 'nan', confidence: Number.NaN, bbox: { x0: 1, y0: 1, x1: 9, y1: 9 } },
                  ],
                },
                { words: [{ text: 'nobox', confidence: 90 }] },
                { words: [{ confidence: 90, bbox: { x0: 1, y0: 1, x1: 9, y1: 9 } }] },
                { words: 'not an array' },
              ],
            },
          ],
        },
      ],
    };
    const result = await run(messy, { minWordConfidence: 0 });
    expect(result.words.map((word) => [word.text, word.confidence])).toEqual([
      ['ok', 0],
      ['nan', 0],
    ]);
    for (const word of result.words) {
      expect(Number.isFinite(word.confidence)).toBe(true);
      for (const value of Object.values(word.bbox)) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it.each([null, undefined, {}, { blocks: null }, { blocks: [{}] }, 'text', 42])(
    'returns an empty result for the page %j',
    async (output) => {
      const result = await run(output);
      expect(result).toMatchObject({ text: '', confidence: 0, lines: [], words: [] });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

describe('image and rectangle handling', () => {
  it.each<[string, Uint8Array]>([
    ['nothing', new Uint8Array(0)],
    ['text', new TextEncoder().encode('definitely not an image at all, just some text')],
    ['a truncated PNG', fakePng().subarray(0, 12)],
    ['a PNG without width', fakePng(0, 10)],
    ['a PNG without height', fakePng(10, 0)],
    ['a gigantic PNG', fakePng(20_000, 20_000)],
    [
      'a JPEG that has no frame header',
      Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0, 0]),
    ],
    ['a truncated JPEG', fakeJpeg(10, 10).subarray(0, 6)],
  ])('rejects %s without bothering the worker', async (_name, image) => {
    const { service, workers } = harness();
    await expect(service.recognize(image)).rejects.toMatchObject({ code: 'invalid-image' });
    expect(workers).toHaveLength(0);
  });

  it.each<[string, Uint8Array]>([
    ['a PNG', fakePng(640, 480)],
    ['a JPEG', fakeJpeg(640, 480)],
    ['a Node buffer', Buffer.from(fakePng(640, 480))],
  ])('accepts %s', async (_name, image) => {
    const { service, workers } = harness();
    const result = await service.recognize(image);
    expect(result.text).toBe('Hello');
    expect(workers[0]?.calls[0]?.image).toBe(image);
  });

  it('reads the JPEG size to validate a rectangle', async () => {
    const { service, workers } = harness();
    await service.recognize(fakeJpeg(640, 480), {
      rectangle: { x: 600, y: 400, width: 500, height: 500 },
    });
    expect(workers[0]?.calls[0]?.rectangle).toEqual({ x: 600, y: 400, width: 40, height: 80 });
  });

  it('finds the JPEG frame header behind stray bytes, fill bytes and restart markers', async () => {
    const jpeg = fakeJpeg(640, 480);
    // SOI, a stray byte, two fill bytes + RST0, TEM, then the usual segments
    const noisy = Uint8Array.from([
      0xff,
      0xd8,
      0x00,
      0xff,
      0xff,
      0xd0,
      0xff,
      0x01,
      ...jpeg.subarray(2),
    ]);
    const { service, workers } = harness();
    await service.recognize(noisy, { rectangle: { x: 600, y: 400, width: 500, height: 500 } });
    expect(workers[0]?.calls[0]?.rectangle).toEqual({ x: 600, y: 400, width: 40, height: 80 });
  });

  it.each<[string, Rect, Rect | undefined]>([
    [
      'rounds outwards to whole pixels',
      { x: 10.4, y: 20.6, width: 100.2, height: 50.1 },
      { x: 10, y: 20, width: 101, height: 51 },
    ],
    [
      'accepts a drag in the other direction',
      { x: 110, y: 70, width: -100, height: -50 },
      { x: 10, y: 20, width: 100, height: 50 },
    ],
    [
      'stays inside the image',
      { x: 350, y: 250, width: 200, height: 200 },
      { x: 350, y: 250, width: 50, height: 50 },
    ],
    [
      'is dropped when it covers the whole image',
      { x: -50, y: -50, width: 500, height: 400 },
      undefined,
    ],
    [
      'is read one pixel narrower when it is a strip over the full width',
      { x: 0, y: 20, width: 400, height: 50 },
      { x: 0, y: 20, width: 399, height: 50 },
    ],
    [
      'keeps its width when the strip does not start at the left edge',
      { x: 10, y: 20, width: 390, height: 50 },
      { x: 10, y: 20, width: 390, height: 50 },
    ],
    [
      'keeps its width when it covers the full height but not the full width',
      { x: 0, y: 0, width: 200, height: 300 },
      { x: 0, y: 0, width: 200, height: 300 },
    ],
  ])('rectangle %s', async (_name, rectangle, expected) => {
    const { service, workers } = harness();
    await service.recognize(fakePng(400, 300), { rectangle });
    expect(workers[0]?.calls[0]?.rectangle).toEqual(expected);
  });

  it.each<[string, Rect]>([
    ['outside of the image', { x: 900, y: 900, width: 50, height: 50 }],
    ['too small', { x: 10, y: 10, width: 2, height: 2 }],
    ['without area', { x: 10, y: 10, width: 0, height: 100 }],
  ])('resolves empty for a rectangle that is %s', async (_name, rectangle) => {
    const { service, workers } = harness();
    const result = await service.recognize(fakePng(400, 300), { rectangle });
    expect(result).toMatchObject({ text: '', lines: [], words: [], confidence: 0, durationMs: 0 });
    expect(workers).toHaveLength(0);
  });

  it.each([Number.NaN, Infinity])('rejects a rectangle containing %s', async (value) => {
    const { service } = harness();
    await expect(
      service.recognize(fakePng(), { rectangle: { x: 0, y: 0, width: value, height: 10 } }),
    ).rejects.toMatchObject({ code: 'invalid-rectangle' });
  });
});

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

describe('request queue', () => {
  it('serves one request at a time, in order', async () => {
    const gates: Array<Deferred<unknown>> = [];
    const { service, workers } = harness(() => {
      const gate = defer<unknown>();
      gates.push(gate);
      return gate.promise;
    });
    const first = service.recognize(fakePng(101, 50));
    const second = service.recognize(fakePng(102, 50));
    const third = service.recognize(fakePng(103, 50));
    await flush();
    expect(workers[0]?.calls).toHaveLength(1);

    gates[0]?.resolve(page([['one', 90, [1, 1, 10, 10]]]));
    expect((await first).text).toBe('one');
    await flush();
    expect(workers[0]?.calls).toHaveLength(2);

    gates[1]?.resolve(page([['two', 90, [1, 1, 10, 10]]]));
    expect((await second).text).toBe('two');
    await flush();
    gates[2]?.resolve(page([['three', 90, [1, 1, 10, 10]]]));
    expect((await third).text).toBe('three');

    expect(workers).toHaveLength(1);
    expect(workers[0]?.calls.map((call) => call.image.byteLength)).toEqual([33, 33, 33]);
  });

  it('keeps serving after a request failed', async () => {
    let calls = 0;
    const { service } = harness(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('Error attempting to read image.'))
        : Promise.resolve(HELLO_PAGE);
    });
    const failing = service.recognize(fakePng());
    const next = service.recognize(fakePng());
    await expect(failing).rejects.toMatchObject({
      code: 'failed',
      message: 'Error attempting to read image.',
    });
    expect((await next).text).toBe('Hello');
  });

  it('lets the newest request replace those that are still waiting', async () => {
    const gate = defer<unknown>();
    let calls = 0;
    const { service, workers } = harness(() => {
      calls += 1;
      return calls === 1 ? gate.promise : Promise.resolve(HELLO_PAGE);
    });
    const running = service.recognize(fakePng());
    await flush();
    const waitingB = service.recognize(fakePng());
    const waitingC = service.recognize(fakePng());
    const newest = service.recognize(fakePng(), { supersedePending: true });
    await expect(waitingB).rejects.toMatchObject({ code: 'superseded' });
    await expect(waitingC).rejects.toMatchObject({ code: 'superseded' });

    gate.resolve(HELLO_PAGE);
    expect((await running).text).toBe('Hello');
    expect((await newest).text).toBe('Hello');
    expect(workers[0]?.calls).toHaveLength(2);
  });

  it('never supersedes the warm-up', async () => {
    const gate = defer<unknown>();
    let calls = 0;
    const { service, workers } = harness(() => {
      calls += 1;
      return calls === 1 ? gate.promise : Promise.resolve(HELLO_PAGE);
    });
    const running = service.recognize(fakePng());
    await flush();
    const warmUp = service.warmUp();
    const newest = service.recognize(fakePng(), { supersedePending: true });
    gate.resolve(HELLO_PAGE);
    await Promise.all([running, warmUp, newest]);
    expect(workers[0]?.calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------------------------

describe('aborting', () => {
  it('rejects a request whose signal is already aborted without starting a worker', async () => {
    const { service, workers } = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(service.recognize(fakePng(), { signal: controller.signal })).rejects.toMatchObject(
      {
        code: 'aborted',
      },
    );
    expect(workers).toHaveLength(0);
  });

  it('removes an aborted request from the queue', async () => {
    const gate = defer<unknown>();
    let calls = 0;
    const { service, workers } = harness(() => {
      calls += 1;
      return calls === 1 ? gate.promise : Promise.resolve(HELLO_PAGE);
    });
    const running = service.recognize(fakePng());
    await flush();
    const controller = new AbortController();
    const waiting = service.recognize(fakePng(), { signal: controller.signal });
    const last = service.recognize(fakePng());
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'aborted' });

    gate.resolve(HELLO_PAGE);
    await Promise.all([running, last]);
    expect(workers[0]?.calls).toHaveLength(2);
  });

  it('releases a running request at once and goes on when the worker is done', async () => {
    const gate = defer<unknown>();
    let calls = 0;
    const { service, workers } = harness(() => {
      calls += 1;
      return calls === 1 ? gate.promise : Promise.resolve(HELLO_PAGE);
    });
    const controller = new AbortController();
    const running = service.recognize(fakePng(), { signal: controller.signal });
    const next = service.recognize(fakePng());
    await flush();
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'aborted' });
    expect(workers[0]?.calls).toHaveLength(1);

    gate.resolve(HELLO_PAGE);
    expect((await next).text).toBe('Hello');
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(0);
  });

  it('replaces a worker that keeps working long after its request was aborted', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { service, workers } = harness(
      () => {
        calls += 1;
        return calls === 1 ? new Promise<unknown>(() => undefined) : Promise.resolve(HELLO_PAGE);
      },
      { abortGraceMs: 500 },
    );
    const controller = new AbortController();
    const running = service.recognize(fakePng(), { signal: controller.signal });
    const next = service.recognize(fakePng());
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'aborted' });
    await vi.advanceTimersByTimeAsync(499);
    expect(workers).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2);
    expect((await next).text).toBe('Hello');
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('stops a request that is aborted while the worker starts', async () => {
    const start = defer<OcrWorker>();
    const worker = new FakeWorker(() => Promise.resolve(HELLO_PAGE));
    const service = createOcrService({
      langPath: 'lang',
      cachePath: 'cache',
      logger: silentLogger,
      workerFactory: () => start.promise,
    });
    const controller = new AbortController();
    const request = service.recognize(fakePng(), { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'aborted' });
    start.resolve(worker);
    await flush();
    expect(worker.calls).toHaveLength(0);
    expect((await service.recognize(fakePng())).text).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------------------------
// Timeouts, crashes, start failures
// ---------------------------------------------------------------------------------------------

describe('failures', () => {
  it('times out a recognition, replaces the worker and carries on', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { service, workers } = harness(
      () => {
        calls += 1;
        return calls === 1 ? new Promise<unknown>(() => undefined) : Promise.resolve(HELLO_PAGE);
      },
      { timeoutMs: 30_000 },
    );
    const stuck = service.recognize(fakePng());
    const assertion = expect(stuck).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(workers[0]?.terminated).toBe(1);

    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(2);
  });

  it('gives up on a worker that does not start and terminates it if it shows up later', async () => {
    vi.useFakeTimers();
    const starts: Array<Deferred<OcrWorker>> = [];
    const service = createOcrService({
      langPath: 'lang',
      cachePath: 'cache',
      logger: silentLogger,
      timeoutMs: 1000,
      workerFactory: () => {
        const start = defer<OcrWorker>();
        starts.push(start);
        return start.promise;
      },
    });
    const request = service.recognize(fakePng());
    const assertion = expect(request).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    const late = new FakeWorker(() => Promise.resolve(HELLO_PAGE));
    starts[0]?.resolve(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.terminated).toBe(1);
  });

  it('tries again to start a worker after a failed start', async () => {
    let attempts = 0;
    const workers: FakeWorker[] = [];
    const service = createOcrService({
      langPath: 'lang',
      cachePath: 'cache',
      logger: silentLogger,
      workerFactory: () => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new OcrError('assets-missing', 'language data missing'));
        }
        const worker = new FakeWorker(() => Promise.resolve(HELLO_PAGE));
        workers.push(worker);
        return Promise.resolve(worker);
      },
    });
    await expect(service.recognize(fakePng())).rejects.toMatchObject({
      code: 'assets-missing',
      message: 'language data missing',
    });
    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(1);
  });

  it('turns a failing factory into an OcrError', async () => {
    const service = createOcrService({
      langPath: 'lang',
      cachePath: 'cache',
      logger: silentLogger,
      workerFactory: () => Promise.reject(new Error('spawn failed')),
    });
    const error: unknown = await service.recognize(fakePng()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OcrError);
    expect(error).toMatchObject({ code: 'failed', message: 'spawn failed' });
  });

  it('retries a request once on a new worker when the worker dies while recognising', async () => {
    const { logger, spies } = spyLogger();
    const { service, workers } = harness(
      (_call, worker) =>
        worker === workers[0]
          ? new Promise<unknown>(() => {
              queueMicrotask(() => {
                worker.crash('the thread was killed');
              });
            })
          : Promise.resolve(HELLO_PAGE),
      { logger },
    );
    const result = await service.recognize(fakePng());
    expect(result.text).toBe('Hello');
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(1);
    expect(spies.warn).toHaveBeenCalledWith('OCR worker crashed, retrying with a new one');
  });

  it('gives up after the retry and starts yet another worker for the next request', async () => {
    let healthy = false;
    const { service, workers } = harness((_call, worker) =>
      healthy
        ? Promise.resolve(HELLO_PAGE)
        : new Promise<unknown>(() => {
            queueMicrotask(() => {
              worker.crash('the thread was killed');
            });
          }),
    );
    await expect(service.recognize(fakePng())).rejects.toMatchObject({
      code: 'worker-crashed',
      message: 'the thread was killed',
    });
    expect(workers).toHaveLength(2);

    healthy = true;
    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(3);
  });

  it('treats a worker that reports its own death as a crash', async () => {
    let calls = 0;
    const { service, workers } = harness(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new OcrError('worker-crashed', 'gone'))
        : Promise.resolve(HELLO_PAGE);
    });
    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('starts a new worker when the old one died while idle', async () => {
    const { service, workers } = harness();
    await service.recognize(fakePng());
    workers[0]?.crash();
    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(2);
  });

  it('keeps the worker after an ordinary error but replaces it after a fatal one', async () => {
    const errors = [
      new Error('Error attempting to read image.'),
      new Error('RuntimeError: memory access out of bounds'),
    ];
    let calls = 0;
    const { service, workers } = harness(() => {
      const error = errors[calls];
      calls += 1;
      return error ? Promise.reject(error) : Promise.resolve(HELLO_PAGE);
    });
    await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'failed' });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(0);

    await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'failed' });
    expect(workers[0]?.terminated).toBe(1);

    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(2);
  });

  it('reports how long a request took, including the worker start', async () => {
    vi.useFakeTimers();
    const { service } = harness(
      () => new Promise<unknown>((resolve) => setTimeout(() => resolve(HELLO_PAGE), 120)),
    );
    const request = service.recognize(fakePng());
    await vi.advanceTimersByTimeAsync(120);
    expect((await request).durationMs).toBe(120);
  });
});

// ---------------------------------------------------------------------------------------------
// Warm-up
// ---------------------------------------------------------------------------------------------

describe('warmUp', () => {
  it('starts the worker and recognises a small image once', async () => {
    const { service, workers } = harness();
    await service.warmUp();
    await service.warmUp();
    expect(workers).toHaveLength(1);
    const calls = workers[0]?.calls ?? [];
    expect(calls).toHaveLength(1);
    expect(Array.from(calls[0]?.image.subarray(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(calls[0]?.rectangle).toBeUndefined();
  });

  it('shares one warm-up between concurrent callers', async () => {
    const { service, workers } = harness();
    await Promise.all([service.warmUp(), service.warmUp(), service.warmUp()]);
    expect(workers[0]?.calls).toHaveLength(1);
  });

  it('is a no-op once the worker has recognised something', async () => {
    const { service, workers } = harness();
    await service.recognize(fakePng());
    await service.warmUp();
    expect(workers[0]?.calls).toHaveLength(1);
  });

  it('warms the next worker up again after a crash', async () => {
    const { service, workers } = harness();
    await service.warmUp();
    workers[0]?.crash();
    await service.warmUp();
    expect(workers).toHaveLength(2);
    expect(workers[1]?.calls).toHaveLength(1);
  });

  it('reports a failure and can be retried', async () => {
    let attempts = 0;
    const service = createOcrService({
      langPath: 'lang',
      cachePath: 'cache',
      logger: silentLogger,
      workerFactory: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new OcrError('assets-missing', 'no data'))
          : Promise.resolve(new FakeWorker(() => Promise.resolve(HELLO_PAGE)));
      },
    });
    await expect(service.warmUp()).rejects.toMatchObject({ code: 'assets-missing' });
    await expect(service.warmUp()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------------------------

describe('dispose', () => {
  it('cancels everything and terminates the worker', async () => {
    const gate = defer<unknown>();
    const { service, workers } = harness(() => gate.promise);
    const running = service.recognize(fakePng());
    const queued = service.recognize(fakePng());
    await flush();
    await service.dispose();
    await expect(running).rejects.toMatchObject({ code: 'disposed' });
    await expect(queued).rejects.toMatchObject({ code: 'disposed' });
    expect(workers[0]?.terminated).toBe(1);
  });

  it('creates a new worker when the service is used again', async () => {
    const { service, workers } = harness();
    await service.recognize(fakePng());
    await service.dispose();
    expect((await service.recognize(fakePng())).text).toBe('Hello');
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(1);
    expect(workers[1]?.terminated).toBe(0);
  });

  it('logs a worker that cannot be terminated instead of failing', async () => {
    const { logger, spies } = spyLogger();
    const { service, workers } = harness(undefined, { logger });
    await service.recognize(fakePng());
    const [worker] = workers;
    if (worker) worker.terminateError = new Error('terminate refused');
    await expect(service.dispose()).resolves.toBeUndefined();
    expect(spies.warn).toHaveBeenCalledWith('OCR worker termination failed', 'terminate refused');
  });

  it('is safe to call without a worker and repeatedly', async () => {
    const { service, workers } = harness();
    await service.dispose();
    await service.dispose();
    await service.recognize(fakePng());
    await service.dispose();
    await service.dispose();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('terminates a worker that finishes starting after the service was disposed', async () => {
    const starts: Array<Deferred<OcrWorker>> = [];
    const service = createOcrService({
      langPath: 'lang',
      cachePath: 'cache',
      logger: silentLogger,
      workerFactory: () => {
        const start = defer<OcrWorker>();
        starts.push(start);
        return start.promise;
      },
    });
    const first = service.recognize(fakePng());
    await flush();
    await service.dispose();
    await expect(first).rejects.toMatchObject({ code: 'disposed' });

    const second = service.recognize(fakePng());
    await flush();
    expect(starts).toHaveLength(2);
    const stale = new FakeWorker(() => Promise.resolve(HELLO_PAGE));
    const fresh = new FakeWorker(() => Promise.resolve(HELLO_PAGE));
    starts[0]?.resolve(stale);
    starts[1]?.resolve(fresh);
    expect((await second).text).toBe('Hello');
    expect(stale.terminated).toBe(1);
    expect(stale.calls).toHaveLength(0);
    expect(fresh.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

describe('releasing memory', () => {
  const FOUR_K = (): Uint8Array => fakePng(3840, 2160);

  it('replaces a worker that has recognised a large image and warms the new one up', async () => {
    const { service, workers } = harness();
    await service.recognize(FOUR_K());
    await vi.waitFor(() => {
      expect(workers).toHaveLength(2);
      expect(workers[1]?.calls).toHaveLength(1);
    });
    expect(workers[0]?.terminated).toBe(1);

    await service.recognize(fakePng(300, 200));
    expect(workers).toHaveLength(2);
    expect(workers[1]?.calls).toHaveLength(2);
  });

  it('waits until nothing else is queued', async () => {
    const { service, workers } = harness();
    await Promise.all([service.recognize(FOUR_K()), service.recognize(FOUR_K())]);
    expect(workers[0]?.calls).toHaveLength(2);
    await vi.waitFor(() => {
      expect(workers).toHaveLength(2);
    });
  });

  it('keeps a worker that only saw ordinary screens', async () => {
    const { service, workers } = harness();
    for (let index = 0; index < 6; index += 1) await service.recognize(fakePng(1920, 1080));
    await flush();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(0);
  });

  it('can be switched off', async () => {
    const { service, workers } = harness(undefined, { largeImagePixels: Infinity });
    await service.recognize(FOUR_K());
    await service.recognize(FOUR_K());
    await flush();
    expect(workers).toHaveLength(1);
  });

  it('uses the configured limit', async () => {
    const { service, workers } = harness(undefined, { largeImagePixels: 1000 });
    await service.recognize(fakePng(100, 50));
    await vi.waitFor(() => {
      expect(workers).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

describe('unpackAsarPath', () => {
  it.each([
    [
      'C:\\App\\resources\\app.asar\\node_modules\\a\\b.js',
      'C:\\App\\resources\\app.asar.unpacked\\node_modules\\a\\b.js',
    ],
    [
      'C:/App/resources/app.asar/node_modules/a/b.js',
      'C:/App/resources/app.asar.unpacked/node_modules/a/b.js',
    ],
    ['C:\\App\\resources\\APP.ASAR\\x', 'C:\\App\\resources\\app.asar.unpacked\\x'],
    ['C:\\App\\resources\\app.asar', 'C:\\App\\resources\\app.asar.unpacked'],
    ['C:\\App\\resources\\app.asar.unpacked\\x', 'C:\\App\\resources\\app.asar.unpacked\\x'],
    ['C:\\dev\\project\\node_modules\\x', 'C:\\dev\\project\\node_modules\\x'],
    ['C:\\my.app.asar.backup\\x', 'C:\\my.app.asar.backup\\x'],
  ])('%s', (input, expected) => {
    expect(unpackAsarPath(input)).toBe(expected);
  });
});

describe('resolveOcrAssets', () => {
  const modules = (root: string): Record<string, string> => ({
    'tesseract.js/src/worker-script/node/index.js': join(
      root,
      'node_modules',
      'tesseract.js',
      'src',
      'worker-script',
      'node',
      'index.js',
    ),
    'tesseract.js-core/package.json': join(
      root,
      'node_modules',
      'tesseract.js-core',
      'package.json',
    ),
    '@tesseract.js-data/eng/package.json': join(
      root,
      'node_modules',
      '@tesseract.js-data',
      'eng',
      'package.json',
    ),
  });
  const resolver = (root: string) => (id: string) => {
    const path = modules(root)[id];
    if (!path) throw new Error(`Cannot find module '${id}'`);
    return path;
  };

  it('uses node_modules during development', () => {
    const root = join('C:', 'dev', 'beekeeper');
    expect(
      resolveOcrAssets({
        isPackaged: false,
        resourcesPath: 'ignored',
        projectRoot: root,
        resolveModule: resolver(root),
      }),
    ).toEqual({
      langPath: join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'),
      workerPath: join(
        root,
        'node_modules',
        'tesseract.js',
        'src',
        'worker-script',
        'node',
        'index.js',
      ),
      corePath: join(root, 'node_modules', 'tesseract.js-core'),
    });
  });

  it('reads the language data from the resources and the code from app.asar.unpacked when packaged', () => {
    const resources = join('C:', 'Program Files', 'Beekeeper', 'resources');
    expect(
      resolveOcrAssets({
        isPackaged: true,
        resourcesPath: resources,
        projectRoot: join(resources, 'app.asar'),
        resolveModule: resolver(join(resources, 'app.asar')),
      }),
    ).toEqual({
      langPath: join(resources, 'tessdata'),
      workerPath: join(
        resources,
        'app.asar.unpacked',
        'node_modules',
        'tesseract.js',
        'src',
        'worker-script',
        'node',
        'index.js',
      ),
      corePath: join(resources, 'app.asar.unpacked', 'node_modules', 'tesseract.js-core'),
    });
  });

  it.each([
    [false, join('C:', 'dev', 'beekeeper', 'node_modules')],
    [
      true,
      join('C:', 'Program Files', 'Beekeeper', 'resources', 'app.asar.unpacked', 'node_modules'),
    ],
  ])(
    'falls back to well-known locations when modules cannot be resolved (packaged: %s)',
    (isPackaged, base) => {
      const assets = resolveOcrAssets({
        isPackaged,
        resourcesPath: join('C:', 'Program Files', 'Beekeeper', 'resources'),
        projectRoot: join('C:', 'dev', 'beekeeper'),
        resolveModule: () => {
          throw new Error('not found');
        },
      });
      expect(assets.workerPath).toBe(
        join(base, 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
      );
      expect(assets.corePath).toBe(join(base, 'tesseract.js-core'));
      expect(assets.langPath).toBe(
        isPackaged
          ? join('C:', 'Program Files', 'Beekeeper', 'resources', 'tessdata')
          : join(
              'C:',
              'dev',
              'beekeeper',
              'node_modules',
              '@tesseract.js-data',
              'eng',
              '4.0.0_best_int',
            ),
      );
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Worker thread protocol (real threads, fake worker scripts)
// ---------------------------------------------------------------------------------------------

const FAKE_WORKER_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const { parentPort, threadId } = require('node:worker_threads');
const received = path.join(__dirname, 'received.jsonl');
const crashFlag = path.join(__dirname, 'crashed.flag');
parentPort.on('message', (packet) => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const { jobId, workerId, action, payload } = packet;
  const entry = { threadId, action, payload };
  if (action === 'recognize') {
    entry.payload = {
      ...payload,
      image: { length: payload.image.length, head: Array.from(payload.image.slice(0, 4)), type: payload.image.constructor.name },
    };
  }
  fs.appendFileSync(received, JSON.stringify(entry) + '\\n');
  const reply = (status, data) => parentPort.postMessage({ jobId, workerId, action, status, data });
  if (cfg.hang === action) return;
  if (cfg.fail && cfg.fail.action === action) {
    reply('reject', cfg.fail.message);
    if (cfg.fail.thenResolve) reply('resolve');
    return;
  }
  if (action !== 'recognize') {
    reply('progress', { status: 'working', progress: 0.5 });
    reply('resolve', {});
    return;
  }
  if (cfg.crash === 'exit') process.exit(3);
  if (cfg.crash === 'throw') { setImmediate(() => { throw new Error('boom in the worker'); }); return; }
  if (cfg.crash === 'once' && !fs.existsSync(crashFlag)) { fs.writeFileSync(crashFlag, '1'); process.exit(3); }
  if (cfg.noise) { console.log('Estimating resolution as 96'); console.error('Image too small to scale'); }
  reply('resolve', cfg.page);
});
`;

interface Received {
  threadId: number;
  action: string;
  payload: Record<string, unknown>;
}

describe('tesseract worker thread', () => {
  let directory = '';
  let workerPath = '';
  let langPath = '';

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'beekeeper-ocr-test-'));
    workerPath = join(directory, 'worker.cjs');
    langPath = join(directory, 'lang');
    mkdirSync(langPath);
    writeFileSync(workerPath, FAKE_WORKER_SCRIPT);
    writeFileSync(join(langPath, 'eng.traineddata.gz'), gzipSync('fake traineddata'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function configure(config: Record<string, unknown>): void {
    writeFileSync(join(directory, 'config.json'), JSON.stringify({ page: HELLO_PAGE, ...config }));
    rmSync(join(directory, 'received.jsonl'), { force: true });
    rmSync(join(directory, 'crashed.flag'), { force: true });
  }

  function received(): Received[] {
    const file = join(directory, 'received.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Received);
  }

  function threadService(
    options: Partial<OcrServiceOptions> = {},
    logger: Logger = silentLogger,
  ): OcrService {
    return createOcrService({
      langPath,
      cachePath: join(directory, 'cache'),
      workerPath,
      corePath: join(directory, 'core'),
      logger,
      timeoutMs: 5000,
      ...options,
    });
  }

  it('configures tesseract for offline, LSTM-only English recognition', async () => {
    configure({});
    const service = threadService();
    await service.warmUp();
    await service.dispose();
    const messages = received();
    expect(messages.map((message) => message.action)).toEqual([
      'load',
      'loadLanguage',
      'initialize',
      'setParameters',
      'recognize',
    ]);
    expect(messages[0]?.payload).toEqual({
      options: { lstmOnly: 1, corePath: join(directory, 'core'), logging: false },
    });
    expect(messages[1]?.payload).toEqual({
      langs: 'eng',
      options: {
        langPath,
        cachePath: join(directory, 'cache'),
        cacheMethod: 'none',
        gzip: true,
        lstmOnly: true,
      },
    });
    expect(messages[2]?.payload).toEqual({ langs: 'eng', oem: 1, config: {} });
    expect(messages[3]?.payload).toEqual({
      params: { tessedit_pageseg_mode: '3', user_defined_dpi: '96' },
    });
  });

  it('sends the image and the region of interest and returns the normalised page', async () => {
    configure({
      page: page([
        ['Hello', 96, [10, 10, 60, 30]],
        ['there', 80, [70, 10, 120, 30]],
      ]),
    });
    const service = threadService();
    const image = fakePng(400, 300);
    const result = await service.recognize(image, {
      rectangle: { x: 5, y: 6, width: 200, height: 100 },
    });
    await service.dispose();
    expect(result.text).toBe('Hello there');
    const recognize = received().find((message) => message.action === 'recognize');
    expect(recognize?.payload).toEqual({
      image: { length: 33, head: [0x89, 0x50, 0x4e, 0x47], type: 'Uint8Array' },
      options: { rectangle: { left: 5, top: 6, width: 200, height: 100 } },
      output: { text: true, blocks: true },
    });
  });

  it('sends no rectangle for the whole image', async () => {
    configure({});
    const service = threadService();
    await service.recognize(Buffer.from(fakePng(400, 300)));
    await service.dispose();
    const recognize = received().find((message) => message.action === 'recognize');
    expect(recognize?.payload['options']).toEqual({});
    expect((recognize?.payload['image'] as { type: string }).type).toBe('Uint8Array');
  });

  it('forwards tesseract console output to the logger instead of stdout', async () => {
    configure({ noise: true });
    const { logger, spies } = spyLogger();
    const service = threadService({}, logger);
    await service.recognize(fakePng());
    await service.dispose();
    await vi.waitFor(
      () => {
        expect(spies.debug).toHaveBeenCalledWith('tesseract:', 'Estimating resolution as 96');
        expect(spies.warn).toHaveBeenCalledWith('tesseract:', 'Image too small to scale');
      },
      { timeout: 5000 },
    );
  });

  it.each(['load', 'loadLanguage', 'initialize', 'setParameters'])(
    'reports the failure of "%s" and stops the thread',
    async (action) => {
      configure({ fail: { action, message: `${action} failed` } });
      const service = threadService();
      await expect(service.recognize(fakePng())).rejects.toMatchObject({
        code: 'failed',
        message: `${action} failed`,
      });
      await service.dispose();
    },
  );

  it('ignores the second answer tesseract sends after a failed initialisation', async () => {
    configure({
      fail: { action: 'initialize', message: 'initialization failed', thenResolve: true },
    });
    const service = threadService();
    await expect(service.recognize(fakePng())).rejects.toMatchObject({
      message: 'initialization failed',
    });
    await flush();
    await service.dispose();
  });

  it('survives a worker thread that dies once while recognising', async () => {
    configure({ crash: 'once' });
    const { logger, spies } = spyLogger();
    const service = threadService({}, logger);
    const result = await service.recognize(fakePng());
    await service.dispose();
    expect(result.text).toBe('Hello');
    const loads = received().filter((message) => message.action === 'load');
    expect(new Set(loads.map((message) => message.threadId)).size).toBe(2);
    expect(spies.warn).toHaveBeenCalledWith(
      'OCR worker died',
      expect.stringContaining('exited with code 3'),
    );
  });

  it.each(['exit', 'throw'])('reports a worker thread that keeps dying (%s)', async (crash) => {
    configure({ crash });
    const service = threadService();
    await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'worker-crashed' });
    await service.dispose();
    const loads = received().filter((message) => message.action === 'load');
    expect(new Set(loads.map((message) => message.threadId)).size).toBe(2);
  });

  it('turns an uncaught exception in the worker into an error with its message', async () => {
    configure({ crash: 'throw' });
    const service = threadService();
    await expect(service.recognize(fakePng())).rejects.toMatchObject({
      code: 'worker-crashed',
      message: 'boom in the worker',
    });
    await service.dispose();
  });

  it('times out a worker that never answers a recognition', async () => {
    configure({ hang: 'recognize' });
    const service = threadService({ timeoutMs: 400 });
    await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'timeout' });
    await service.dispose();
  });

  it('times out a worker that never finishes loading', async () => {
    configure({ hang: 'load' });
    const service = threadService({ timeoutMs: 400 });
    await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'timeout' });
    await service.dispose();
  });

  describe('missing assets', () => {
    it('refuses to download language data from a URL', async () => {
      configure({});
      const service = threadService({ langPath: 'https://cdn.example.com/tessdata' });
      await expect(service.recognize(fakePng())).rejects.toMatchObject({
        code: 'assets-missing',
        message: expect.stringContaining('local directory') as string,
      });
      expect(received()).toEqual([]);
    });

    it.each([
      ['an empty path', ''],
      ['a missing directory', 'C:\\this\\directory\\does\\not\\exist'],
    ])('fails fast for %s', async (_name, missing) => {
      configure({});
      const service = threadService({ langPath: missing });
      await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'assets-missing' });
      expect(received()).toEqual([]);
    });

    it('rejects language data that is not gzip', async () => {
      configure({});
      const broken = join(directory, 'broken');
      mkdirSync(broken, { recursive: true });
      writeFileSync(join(broken, 'eng.traineddata.gz'), 'plain text');
      const service = threadService({ langPath: broken });
      await expect(service.recognize(fakePng())).rejects.toMatchObject({ code: 'assets-missing' });
    });

    it('reports a missing worker script', async () => {
      configure({});
      const service = threadService({ workerPath: join(directory, 'nope.cjs') });
      await expect(service.recognize(fakePng())).rejects.toMatchObject({
        code: 'assets-missing',
        message: expect.stringContaining('worker script') as string,
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Real tesseract
// ---------------------------------------------------------------------------------------------

interface Line {
  text: string;
  baseline: number;
}

function renderPng(options: {
  width: number;
  height: number;
  lines: Line[];
  fontSize: number;
  color?: string;
  background?: string;
}): Buffer {
  const { width, height, lines, fontSize, color = '#000000', background = '#ffffff' } = options;
  const texts = lines
    .map(
      (line) =>
        `<text x="40" y="${line.baseline}" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="${color}">${line.text}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/>${texts}</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
}

describe('real OCR (tesseract.js in a worker thread)', () => {
  let service: OcrService;
  let warmUpMs = 0;

  beforeAll(async () => {
    const assets = resolveOcrAssets({
      isPackaged: false,
      resourcesPath: '',
      projectRoot: process.cwd(),
      resolveModule: (id) => nodeRequire.resolve(id),
    });
    service = createOcrService({
      ...assets,
      cachePath: join(tmpdir(), 'beekeeper-ocr-test-cache'),
      logger: silentLogger,
    });
    const started = performance.now();
    await service.warmUp();
    warmUpMs = Math.round(performance.now() - started);
  }, 30_000);

  afterAll(async () => {
    await service.dispose();
  });

  function insideImage(box: Rect, width: number, height: number): boolean {
    return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  }

  it('warms up quickly', () => {
    expect(warmUpMs).toBeLessThan(15_000);
  });

  it('reads a line of text and reports where every word is', async () => {
    const fontSize = 48;
    const image = renderPng({
      width: 900,
      height: 160,
      lines: [{ text: 'Hello Beekeeper 12345', baseline: 90 }],
      fontSize,
    });
    const result = await service.recognize(image);

    expect(result.words.map((word) => word.text)).toEqual(['Hello', 'Beekeeper', '12345']);
    expect(result.text).toBe('Hello Beekeeper 12345');
    expect(result.confidence).toBeGreaterThan(80);
    expect(result.durationMs).toBeGreaterThan(0);

    let previousRight = 0;
    for (const word of result.words) {
      expect(insideImage(word.bbox, 900, 160)).toBe(true);
      // drawn at x=40 on baseline y=90: the words sit on that line, left to right
      expect(word.bbox.y).toBeGreaterThan(90 - fontSize);
      expect(word.bbox.y + word.bbox.height).toBeLessThan(90 + fontSize * 0.4);
      expect(word.bbox.height).toBeGreaterThan(fontSize * 0.4);
      expect(word.bbox.x).toBeGreaterThanOrEqual(previousRight);
      previousRight = word.bbox.x + word.bbox.width;
      expect(word.lineIndex).toBe(0);
    }
    expect(result.words[0]?.bbox.x).toBeGreaterThan(30);
    expect(result.words[0]?.bbox.x).toBeLessThan(60);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.bbox.width).toBeGreaterThan(300);
  });

  it('reads several lines in order', async () => {
    const image = renderPng({
      width: 900,
      height: 280,
      lines: [
        { text: 'Hello Beekeeper 12345', baseline: 60 },
        { text: 'Second line of text', baseline: 124 },
        { text: 'Third line: foo@bar.com', baseline: 188 },
      ],
      fontSize: 40,
    });
    const result = await service.recognize(image);
    const lower = result.lines.map((line) => line.text.toLowerCase());
    expect(result.lines).toHaveLength(3);
    expect(lower[0]).toContain('beekeeper');
    expect(lower[1]).toContain('second');
    expect(lower[2]).toContain('third');
    expect(result.text.split('\n')).toHaveLength(3);
    const tops = result.lines.map((line) => line.bbox.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    result.words.forEach((word) => {
      expect(word.lineIndex).toBeGreaterThanOrEqual(0);
      expect(result.lines[word.lineIndex]?.words).toContain(word);
      expect(insideImage(word.bbox, 900, 280)).toBe(true);
    });
    expect(result.text.toLowerCase()).toContain('foo@bar.com');
  });

  it('reads small interface text', async () => {
    const image = renderPng({
      width: 500,
      height: 90,
      lines: [
        { text: 'Settings Notifications Privacy', baseline: 30 },
        { text: 'Accessibility and Windows Update', baseline: 56 },
      ],
      fontSize: 13,
    });
    const result = await service.recognize(image);
    const text = result.text.toLowerCase();
    for (const word of [
      'settings',
      'notifications',
      'privacy',
      'accessibility',
      'windows',
      'update',
    ]) {
      expect(text).toContain(word);
    }
    expect(result.words.every((word) => insideImage(word.bbox, 500, 90))).toBe(true);
  });

  it('reads light text on a dark background', async () => {
    const image = renderPng({
      width: 700,
      height: 120,
      lines: [{ text: 'Dark mode screenshot', baseline: 70 }],
      fontSize: 40,
      color: '#f2f2f2',
      background: '#1b1b1b',
    });
    const result = await service.recognize(image);
    expect(result.text.toLowerCase()).toContain('dark mode');
  });

  it('only reads the requested rectangle but reports full-image coordinates', async () => {
    const image = renderPng({
      width: 900,
      height: 280,
      lines: [
        { text: 'Hello Beekeeper 12345', baseline: 60 },
        { text: 'Second line of text', baseline: 124 },
        { text: 'Third line of words', baseline: 188 },
      ],
      fontSize: 40,
    });
    const rectangle = { x: 0, y: 90, width: 900, height: 56 };
    const result = await service.recognize(image, { rectangle });
    const text = result.text.toLowerCase();
    expect(text).toContain('second');
    expect(text).not.toContain('hello');
    expect(text).not.toContain('third');
    for (const word of result.words) {
      expect(word.bbox.y).toBeGreaterThanOrEqual(rectangle.y - 1);
      expect(word.bbox.y + word.bbox.height).toBeLessThanOrEqual(
        rectangle.y + rectangle.height + 1,
      );
    }
    expect(result.words[0]?.bbox.x).toBeGreaterThan(30);
  });

  it('returns no text for an empty image', async () => {
    const image = renderPng({ width: 400, height: 200, lines: [], fontSize: 20 });
    const result = await service.recognize(image);
    expect(result).toMatchObject({ text: '', lines: [], words: [], confidence: 0 });
  });

  it('answers concurrent requests one after the other with the right text', async () => {
    const images = ['Alpha', 'Bravo', 'Charlie'].map((text) =>
      renderPng({ width: 500, height: 120, lines: [{ text, baseline: 80 }], fontSize: 48 }),
    );
    const results = await Promise.all(images.map((image) => service.recognize(image)));
    expect(results.map((result) => result.text)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('cancels a request that is waiting behind another one', async () => {
    const image = renderPng({
      width: 500,
      height: 120,
      lines: [{ text: 'Delta', baseline: 80 }],
      fontSize: 48,
    });
    const controller = new AbortController();
    const running = service.recognize(image);
    const cancelled = service.recognize(image, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' });
    expect((await running).text).toBe('Delta');
  });

  it('survives a corrupt image', async () => {
    const png = renderPng({
      width: 500,
      height: 120,
      lines: [{ text: 'Echo', baseline: 80 }],
      fontSize: 48,
    });
    const corrupt = Buffer.concat([png.subarray(0, 100), Buffer.alloc(200, 7)]);
    await expect(service.recognize(corrupt)).rejects.toBeInstanceOf(OcrError);
    expect((await service.recognize(png)).text).toBe('Echo');
  });
});

// ---------------------------------------------------------------------------------------------
// asarUnpack list
// ---------------------------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\ue000')
    .replace(/\*/g, '[^/]*')
    .replace(/\ue000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

describe('OCR_ASAR_UNPACK', () => {
  const RECORDER = `
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const log = path.join(__dirname, 'loaded.txt');
const record = (file) => { if (typeof file === 'string' && path.isAbsolute(file)) fs.appendFileSync(log, file + '\\n'); };
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (...args) { const file = resolveFilename.apply(this, args); record(file); return file; };
const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...rest) { record(file); return readFileSync.call(this, file, ...rest); };
const real = JSON.parse(readFileSync(path.join(__dirname, 'target.json'), 'utf8')).workerPath;
require(real);
`;

  it('covers every file the worker thread loads from node_modules', async () => {
    const assets = resolveOcrAssets({
      isPackaged: false,
      resourcesPath: '',
      projectRoot: process.cwd(),
      resolveModule: (id) => nodeRequire.resolve(id),
    });
    const directory = mkdtempSync(join(tmpdir(), 'beekeeper-ocr-closure-'));
    try {
      writeFileSync(join(directory, 'recorder.cjs'), RECORDER);
      writeFileSync(
        join(directory, 'target.json'),
        JSON.stringify({ workerPath: assets.workerPath }),
      );
      const service = createOcrService({
        ...assets,
        workerPath: join(directory, 'recorder.cjs'),
        cachePath: directory,
        logger: silentLogger,
      });
      const image = renderPng({
        width: 300,
        height: 100,
        lines: [{ text: 'Zulu', baseline: 70 }],
        fontSize: 48,
      });
      expect((await service.recognize(image)).text).toBe('Zulu');
      await service.dispose();

      const root = process.cwd();
      const loaded = readFileSync(join(directory, 'loaded.txt'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((file) => relative(root, file).split(sep).join('/'))
        .filter((file) => file.startsWith('node_modules/'));
      const matchers = OCR_ASAR_UNPACK.map(globToRegExp);
      const uncovered = [...new Set(loaded)].filter(
        (file) => !matchers.some((matcher) => matcher.test(file)),
      );

      expect(uncovered).toEqual([]);
      expect(loaded).toContain('node_modules/tesseract.js/src/worker-script/node/index.js');
      expect(loaded.some((file) => /tesseract-core-.*lstm\.wasm$/.test(file))).toBe(true);
      expect(loaded.some((file) => file.startsWith('node_modules/regenerator-runtime/'))).toBe(
        true,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

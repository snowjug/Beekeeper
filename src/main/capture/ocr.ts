/**
 * Offline OCR for Circle to Search.
 *
 * One tesseract.js engine runs in a Node worker thread that is created once, warmed up on app
 * start and reused. Requests are served one at a time; the worker is replaced automatically when
 * it crashes or hangs. Nothing is fetched from the network: the English traineddata is read from
 * `langPath`, and neither the data nor the recognised text is ever written to disk or logged.
 *
 * tesseract.js' own `createWorker` is not used because it cannot be made reliable in the main
 * process: it never settles when the language data is unusable, hides the worker thread (which
 * then cannot be terminated) and lets thread errors surface as uncaught exceptions. The thread is
 * therefore driven directly through the message protocol of tesseract.js 7's worker script
 * (`load`, `loadLanguage`, `initialize`, `setParameters`, `recognize`).
 */
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { clampRect, normalizeRect, type Rect, type Size } from '@shared/geometry';
import type { Logger } from '@shared/logger';
import { WORKER_SCRIPT_MODULE, unpackAsarPath } from './ocr-assets';

export interface OcrWord {
  text: string;
  /** 0-100 */
  confidence: number;
  /** Image pixel coordinates. */
  bbox: Rect;
  /** Index of the line in `OcrResult.lines` this word belongs to. */
  lineIndex: number;
}

export interface OcrLine {
  text: string;
  /** 0-100 */
  confidence: number;
  bbox: Rect;
  words: OcrWord[];
}

export interface OcrResult {
  /** Lines in reading order, joined with `\n`. */
  text: string;
  /** 0-100, mean word confidence weighted by word length. */
  confidence: number;
  lines: OcrLine[];
  /** All words of all lines. */
  words: OcrWord[];
  /** Time spent on this request after it left the queue (includes starting the worker when needed). */
  durationMs: number;
}

export interface OcrRecognizeOptions {
  /** Cancels the request. A request that is already running is released immediately. */
  signal?: AbortSignal;
  /** Only recognise this part of the image (image pixels). Boxes in the result stay in image coordinates. */
  rectangle?: Rect;
  /** Rejects the requests that are still waiting in the queue with code `superseded` (latest wins). */
  supersedePending?: boolean;
}

export interface OcrService {
  /** Starts the worker, loads the English data and runs a tiny recognition so the first real one is fast. */
  warmUp(): Promise<void>;
  /**
   * Recognises text in PNG or JPEG bytes. Resolves with an empty result when there is no text (or
   * `rectangle` has no area inside the image); rejects with an {@link OcrError} otherwise.
   */
  recognize(image: Uint8Array, options?: OcrRecognizeOptions): Promise<OcrResult>;
  /** Cancels all requests and terminates the worker. The service starts a new worker if it is used again. */
  dispose(): Promise<void>;
}

export type OcrErrorCode =
  | 'aborted'
  | 'superseded'
  | 'timeout'
  | 'worker-crashed'
  | 'disposed'
  | 'invalid-image'
  | 'invalid-rectangle'
  | 'assets-missing'
  | 'failed';

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OcrError';
  }
}

/** What an OCR worker has to provide (the tesseract thread by default, a fake in unit tests). */
export interface OcrWorker {
  /**
   * Resolves with the tesseract.js page output: `blocks` > `paragraphs` > `lines` > `words`, each
   * with `text`, `confidence` and `bbox: { x0, y0, x1, y1 }`, in image pixel coordinates.
   */
  recognize(image: Uint8Array, rectangle?: Rect): Promise<unknown>;
  terminate(): Promise<void>;
  /** The listener is called once when the worker dies without `terminate()` having been called. */
  onCrash(listener: (error: Error) => void): void;
}

export interface OcrWorkerConfig {
  langPath: string;
  cachePath: string;
  /** Null when no worker script could be located. */
  workerPath: string | null;
  corePath: string | undefined;
  timeoutMs: number;
  logger: Logger;
}

export type OcrWorkerFactory = (config: OcrWorkerConfig) => Promise<OcrWorker>;

export interface OcrServiceOptions {
  /** Directory that contains `eng.traineddata.gz`. Must be a local path: nothing is downloaded. */
  langPath: string;
  /** Where tesseract may cache data. The cache is disabled, so nothing is written there. */
  cachePath: string;
  /** Worker script of tesseract.js; located through `require.resolve` when omitted. */
  workerPath?: string;
  /** Passed to the worker (ignored by tesseract.js in Node, which resolves the core next to the script). */
  corePath?: string;
  logger: Logger;
  /** Replaces the tesseract worker (tests). */
  workerFactory?: OcrWorkerFactory;
  /** Limit for starting the worker and for one recognition. Default 30 s. */
  timeoutMs?: number;
  /** Words with a lower confidence (0-100) are dropped as noise. Default 25. */
  minWordConfidence?: number;
  /**
   * The WebAssembly heap grows to fit the largest image and never shrinks, so a worker that has
   * recognised an image with at least this many pixels (above 1440p: 4K is 8.3 million) is replaced
   * by a fresh, warmed-up one as soon as no request is waiting. Default 4,000,000; `Infinity`
   * keeps the worker.
   */
  largeImagePixels?: number;
  /** How long a running recognition may continue after its request was aborted before the worker is replaced. Default 1 s. */
  abortGraceMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ABORT_GRACE_MS = 1_000;
const DEFAULT_MIN_WORD_CONFIDENCE = 25;
const DEFAULT_LARGE_IMAGE_PIXELS = 4_000_000;
const MAX_CRASH_RETRIES = 1;
const MAX_IMAGE_PIXELS = 64_000_000;
const MIN_RECOGNIZABLE_SIDE = 3;
const LANGUAGE_FILE = 'eng.traineddata.gz';
const PAGE_SEGMENTATION_AUTO = '3';
const ASSUMED_DPI = '96';
// OEM.LSTM_ONLY. tesseract.js' node adapter compares this value with the OEM constants to pick the
// smaller LSTM-only WebAssembly core (it receives a boolean from createWorker and then never does).
const LSTM_ONLY = 1;
const FATAL_WORKER_ERROR = /abort|out of memory|memory access|unreachable|RuntimeError|RangeError/i;

/** 176x40 4-bit grayscale PNG of the text "Beekeeper 123", recognised once to warm the engine up. */
const WARM_UP_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAALAAAAAoBAAAAAC+GcKtAAACnklEQVR42u2WT08TQRjGp3TZLW2xa0ggRoyNJ4xG8AYXUqMHY0zKB9CwN0/SHvAgB6nEwxpjQD+AePDmgTUmQFG68AkWE4/GqvHgbSMZWNsp+5h3aGAXFyIEEw+dw/x5kv3N7PO++84y/KPGWuAWuAX+f8BbleMBm+YTNyR7qb96+jGAH/eeAli88yIKzBg7dQTwWw2o6efYLDbYQJsTAY6/W9DnDg1+FdMAfhurnfBsFPMRYAWYKRwafGWCTgzUNFqtZ6LBFm24LANn74J3BACfZF/Z7StCErE98H3AL6fhj7DTQF1nYwTeVOHn2AVykT0AzzynMPg5dhFCexYkNoef/ZFg0eXim1bO2igNzSsENgr42lPWHRRvzCvgHX2L+iw+9JT1qtC6J4LgzSQA37AjwLFr+hhQnMNafqsLKNpeqqYChk2CQhPe5mLtEkYcrBREbBpB8EoeGM/dQiQ4q1TJEJ4hd61JLzUzDL9dCmkSeAcZ31ABfla0IQiud7nAeLbbjbTCL/ULxTQfpXnCNEujnhp3QcJUJwlGgaeBXx1SyYj2ELg0TL1fHI4OnpcUjDGW4tTnPZYCalJYlwLFvJbwaJ5pOtAEf2+uvMQ+YC2YNV7ipBNKI95JVtS1gLXbE/+yHTI84sR+XCKT2x/Iai8a8pU30hKcBHhaqH+AN9M4GGydQc4GHKEADYpTzCHBl4IAp1TPI+vAd0PgL6M0+0zbRmbFVTaHVe311CSMwbJBeTzTC0tbmppEbnDRAI8PLcSqsHqWHtohsHXdNM3qm/vlgUJkdYvfBRoDTK3CY+w8gWsxJyDwE0V2E2hkmRo+sUXxtD8y1ndQoX+/p8j7UmhUZAhlkPzl6IIklo94Ne0pMcd357XArR+WFvg4228/1ntfqN3WYgAAAABJRU5ErkJggg==',
  'base64',
);
const WARM_UP_SIZE: Size = { width: 176, height: 40 };

// ---------------------------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------------------------

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function readPngSize(bytes: Uint8Array): Size | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  const header = String.fromCharCode(...bytes.subarray(12, 16));
  if (header !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegSize(bytes: Uint8Array): Size | null {
  if (byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (byteAt(bytes, offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = byteAt(bytes, offset + 1);
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += marker === 0xff ? 1 : 2;
      continue;
    }
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        height: (byteAt(bytes, offset + 5) << 8) | byteAt(bytes, offset + 6),
        width: (byteAt(bytes, offset + 7) << 8) | byteAt(bytes, offset + 8),
      };
    }
    if (marker === 0xda) return null;
    offset += 2 + ((byteAt(bytes, offset + 2) << 8) | byteAt(bytes, offset + 3));
  }
  return null;
}

/** Image size from the PNG or JPEG header, or null when the bytes are neither (or are absurdly large). */
function readImageSize(bytes: Uint8Array): Size | null {
  const size = readPngSize(bytes) ?? readJpegSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size.width * size.height <= MAX_IMAGE_PIXELS ? size : null;
}

/** Integer pixel rectangle inside the image, or null when it has (almost) no area there. */
function resolveRectangle(rectangle: Rect, image: Size): Rect | null {
  const values = [rectangle.x, rectangle.y, rectangle.width, rectangle.height];
  if (!values.every(Number.isFinite)) {
    throw new OcrError('invalid-rectangle', 'The OCR rectangle must consist of finite numbers');
  }
  const clipped = clampRect(normalizeRect(rectangle), {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
  const x = Math.floor(clipped.x);
  const y = Math.floor(clipped.y);
  const height = Math.ceil(clipped.y + clipped.height) - y;
  let width = Math.ceil(clipped.x + clipped.width) - x;
  // tesseract.js-core garbles a strip that spans the whole image width from the left edge (every
  // such request came back as one or two bogus words); one pixel less is read correctly.
  if (x === 0 && width === image.width && height < image.height) width -= 1;
  if (width < MIN_RECOGNIZABLE_SIDE || height < MIN_RECOGNIZABLE_SIDE) return null;
  return { x, y, width, height };
}

// ---------------------------------------------------------------------------------------------
// tesseract.js output -> OcrResult
// ---------------------------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// eslint-disable-next-line no-control-regex
const NOISE_CHARS = /[\u0000-\u001f\u007f-\u009f\ufffd]/g;

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(NOISE_CHARS, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function wordBox(value: unknown, image: Rect): Rect | null {
  const box = asRecord(value);
  if (!box) return null;
  const x0 = finiteNumber(box['x0']);
  const y0 = finiteNumber(box['y0']);
  const x1 = finiteNumber(box['x1']);
  const y1 = finiteNumber(box['y1']);
  if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
  const clipped = clampRect({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, image);
  return clipped.width > 0 && clipped.height > 0 ? clipped : null;
}

function union(boxes: readonly Rect[]): Rect {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function weightedConfidence(words: readonly OcrWord[]): number {
  const total = words.reduce((sum, word) => sum + word.text.length, 0);
  if (total === 0) return 0;
  const weighted = words.reduce((sum, word) => sum + word.confidence * word.text.length, 0);
  return roundTo(weighted / total, 1);
}

function emptyResult(durationMs: number): OcrResult {
  return { text: '', confidence: 0, lines: [], words: [], durationMs };
}

/** Normalises a tesseract.js page: noise words dropped, whitespace collapsed, numbers always defined. */
function toResult(
  page: unknown,
  image: Rect,
  minConfidence: number,
  durationMs: number,
): OcrResult {
  const lines: OcrLine[] = [];
  const words: OcrWord[] = [];
  for (const block of asArray(asRecord(page)?.['blocks'])) {
    for (const paragraph of asArray(asRecord(block)?.['paragraphs'])) {
      for (const rawLine of asArray(asRecord(paragraph)?.['lines'])) {
        const lineWords: OcrWord[] = [];
        for (const rawWord of asArray(asRecord(rawLine)?.['words'])) {
          const record = asRecord(rawWord);
          const text = cleanText(record?.['text']);
          const confidence = Math.min(100, Math.max(0, finiteNumber(record?.['confidence']) ?? 0));
          const bbox = wordBox(record?.['bbox'], image);
          if (text.length > 0 && bbox && confidence >= minConfidence) {
            lineWords.push({
              text,
              confidence: roundTo(confidence, 1),
              bbox,
              lineIndex: lines.length,
            });
          }
        }
        if (lineWords.length === 0) continue;
        lines.push({
          text: lineWords.map((word) => word.text).join(' '),
          confidence: weightedConfidence(lineWords),
          bbox: union(lineWords.map((word) => word.bbox)),
          words: lineWords,
        });
        words.push(...lineWords);
      }
    }
  }
  return {
    text: lines.map((line) => line.text).join('\n'),
    confidence: weightedConfidence(words),
    lines,
    words,
    durationMs,
  };
}

// ---------------------------------------------------------------------------------------------
// tesseract.js worker thread
// ---------------------------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value instanceof Error ? value.message : 'Unknown OCR worker error';
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(errorText(value));
}

/** Talks to the worker script of tesseract.js 7 (see the file comment). */
class ThreadOcrWorker implements OcrWorker {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly crashListeners: Array<(error: Error) => void> = [];
  private nextId = 1;
  private terminating = false;
  private dead = false;
  private crash: Error | null = null;

  constructor(
    private readonly thread: Worker,
    private readonly logger: Logger,
  ) {
    thread.on('message', (message: unknown) => {
      this.handleMessage(message);
    });
    thread.on('error', (error: unknown) => {
      this.handleDeath(toError(error));
    });
    thread.on('messageerror', (error: unknown) => {
      this.handleDeath(toError(error));
    });
    thread.on('exit', (code: number) => {
      this.handleDeath(new Error(`The OCR worker thread exited with code ${code}`));
    });
    // tesseract prints progress and diagnostics to the console; keep them out of stdout.
    thread.stdout.setEncoding('utf8');
    thread.stderr.setEncoding('utf8');
    thread.stdout.on('data', (text: string) => {
      this.logger.debug('tesseract:', text.trim().slice(0, 300));
    });
    thread.stderr.on('data', (text: string) => {
      this.logger.warn('tesseract:', text.trim().slice(0, 300));
    });
  }

  async initialize(config: OcrWorkerConfig): Promise<void> {
    // one budget for the four steps together
    const deadline = performance.now() + config.timeoutMs;
    const limit = (): number => Math.max(1, deadline - performance.now());
    await this.request(
      'load',
      { options: { lstmOnly: LSTM_ONLY, corePath: config.corePath, logging: false } },
      limit(),
    );
    await this.request(
      'loadLanguage',
      {
        langs: 'eng',
        options: {
          langPath: config.langPath,
          cachePath: config.cachePath,
          cacheMethod: 'none',
          gzip: true,
          lstmOnly: true,
        },
      },
      limit(),
    );
    await this.request('initialize', { langs: 'eng', oem: LSTM_ONLY, config: {} }, limit());
    await this.request(
      'setParameters',
      { params: { tessedit_pageseg_mode: PAGE_SEGMENTATION_AUTO, user_defined_dpi: ASSUMED_DPI } },
      limit(),
    );
  }

  recognize(image: Uint8Array, rectangle?: Rect): Promise<unknown> {
    const options = rectangle
      ? {
          rectangle: {
            left: rectangle.x,
            top: rectangle.y,
            width: rectangle.width,
            height: rectangle.height,
          },
        }
      : {};
    return this.request('recognize', { image, options, output: { text: true, blocks: true } });
  }

  async terminate(): Promise<void> {
    this.terminating = true;
    this.failAll(new OcrError('aborted', 'The OCR worker was terminated'));
    try {
      await this.thread.terminate();
    } catch (error) {
      this.logger.warn('OCR worker termination failed', errorText(error));
    }
  }

  onCrash(listener: (error: Error) => void): void {
    if (this.crash) listener(this.crash);
    else this.crashListeners.push(listener);
  }

  private request(action: string, payload: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.dead || this.terminating) {
      return Promise.reject(new OcrError('worker-crashed', 'The OCR worker is not running'));
    }
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      let timer: NodeJS.Timeout | null = null;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new OcrError('timeout', `The OCR worker did not answer "${action}" in ${timeoutMs} ms`),
          );
        }, timeoutMs);
        timer.unref();
      }
      this.pending.set(id, { resolve, reject, timer });
      this.thread.postMessage({ workerId: 'beekeeper-ocr', jobId: id, action, payload });
    });
  }

  private handleMessage(message: unknown): void {
    const packet = asRecord(message);
    const id = finiteNumber(packet?.['jobId']);
    const status = packet?.['status'];
    if (id === null || (status !== 'resolve' && status !== 'reject')) return;
    // A later message for a request that was already answered (initialize rejects and then resolves) is ignored.
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    if (request.timer) clearTimeout(request.timer);
    if (status === 'resolve') request.resolve(packet?.['data']);
    else request.reject(new OcrError('failed', errorText(packet?.['data'])));
  }

  private handleDeath(error: Error): void {
    if (this.dead) return;
    this.dead = true;
    if (this.terminating) return;
    this.crash = error;
    this.logger.warn('OCR worker died', error.message);
    this.failAll(new OcrError('worker-crashed', error.message, { cause: error }));
    for (const listener of this.crashListeners.splice(0)) listener(error);
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function locateWorkerScript(): string | null {
  try {
    return typeof require === 'function'
      ? unpackAsarPath(require.resolve(WORKER_SCRIPT_MODULE))
      : null;
  } catch {
    return null;
  }
}

async function readHead(path: string, length: number): Promise<Buffer | null> {
  try {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Fails early and clearly when the local assets are unusable (tesseract.js would hang or crash). */
async function assertAssets(config: OcrWorkerConfig): Promise<string> {
  const { langPath, workerPath } = config;
  if (langPath.length === 0 || /^[a-z][a-z0-9+.-]*:\/\//i.test(langPath)) {
    throw new OcrError('assets-missing', 'The OCR language data must be a local directory');
  }
  const head = await readHead(join(langPath, LANGUAGE_FILE), 2);
  if (head?.[0] !== 0x1f || head[1] !== 0x8b) {
    throw new OcrError(
      'assets-missing',
      `OCR language data ${LANGUAGE_FILE} not found in ${langPath}`,
    );
  }
  if (!workerPath || !(await stat(workerPath).catch(() => null))?.isFile()) {
    throw new OcrError(
      'assets-missing',
      `OCR worker script not found at ${workerPath ?? 'tesseract.js'}`,
    );
  }
  return workerPath;
}

async function startThreadWorker(config: OcrWorkerConfig): Promise<OcrWorker> {
  const workerPath = await assertAssets(config);
  let thread: Worker;
  try {
    thread = new Worker(workerPath, { stdout: true, stderr: true });
  } catch (error) {
    throw new OcrError('assets-missing', 'The OCR worker thread could not be started', {
      cause: error,
    });
  }
  const worker = new ThreadOcrWorker(thread, config.logger);
  try {
    await worker.initialize(config);
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  return worker;
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // Whoever races on the promise handles the rejection; an unused one must not become "unhandled".
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function timeoutGuard(
  ms: number,
  message: string,
): { promise: Promise<never>; cancel: () => void } {
  const guard = deferred<never>();
  const timer = setTimeout(() => {
    guard.reject(new OcrError('timeout', message));
  }, ms);
  timer.unref();
  return { promise: guard.promise, cancel: () => clearTimeout(timer) };
}

interface WorkerSlot {
  worker: OcrWorker;
  dead: boolean;
  warmed: boolean;
  /** Pixels of the largest image this worker has recognised. */
  largestImage: number;
  /** Rejects when the worker is lost, so a request waiting for it does not have to wait for a timeout. */
  lost: Deferred<never>;
}

interface Job {
  image: Uint8Array;
  size: Size;
  /** Null: the whole image. */
  rectangle: Rect | null;
  /** Warm-up requests are not delivered to a caller and are never superseded. */
  internal: boolean;
  settled: boolean;
  resolve: (result: OcrResult) => void;
  reject: (error: Error) => void;
  detachSignal: () => void;
  /** Rejects when an aborted, still running recognition overstays its grace period. */
  interrupt: Deferred<never>;
  cancelInterrupt: () => void;
}

function toOcrError(error: unknown): OcrError {
  if (error instanceof OcrError) return error;
  return new OcrError('failed', errorText(error), { cause: error });
}

class OcrEngine implements OcrService {
  private readonly factory: OcrWorkerFactory;
  private readonly config: OcrWorkerConfig;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly abortGraceMs: number;
  private readonly minWordConfidence: number;
  private readonly largeImagePixels: number;
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private slot: WorkerSlot | null = null;
  private starting: Promise<WorkerSlot> | null = null;
  private warmUpRequest: Promise<void> | null = null;
  private epoch = 0;

  constructor(options: OcrServiceOptions) {
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.abortGraceMs = options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS;
    this.minWordConfidence = options.minWordConfidence ?? DEFAULT_MIN_WORD_CONFIDENCE;
    this.largeImagePixels = options.largeImagePixels ?? DEFAULT_LARGE_IMAGE_PIXELS;
    this.factory = options.workerFactory ?? startThreadWorker;
    this.config = {
      langPath: options.langPath,
      cachePath: options.cachePath,
      workerPath: options.workerPath ?? locateWorkerScript(),
      corePath: options.corePath,
      timeoutMs: this.timeoutMs,
      logger: options.logger,
    };
  }

  warmUp(): Promise<void> {
    if (this.slot && !this.slot.dead && this.slot.warmed) return Promise.resolve();
    if (!this.warmUpRequest) {
      const request = new Promise<void>((resolve, reject) => {
        this.enqueue(
          WARM_UP_PNG,
          WARM_UP_SIZE,
          null,
          undefined,
          true,
          () => {
            resolve();
          },
          reject,
        );
      });
      this.warmUpRequest = request;
      const clear = (): void => {
        if (this.warmUpRequest === request) this.warmUpRequest = null;
      };
      request.then(clear, clear);
    }
    return this.warmUpRequest;
  }

  recognize(image: Uint8Array, options: OcrRecognizeOptions = {}): Promise<OcrResult> {
    const { signal, rectangle, supersedePending } = options;
    if (signal?.aborted) return Promise.reject(new OcrError('aborted', 'OCR was cancelled'));
    const size = readImageSize(image);
    if (!size) {
      return Promise.reject(
        new OcrError('invalid-image', 'OCR needs a PNG or JPEG image of a sensible size'),
      );
    }
    let region: Rect | null = null;
    if (rectangle) {
      try {
        region = resolveRectangle(rectangle, size);
      } catch (error) {
        return Promise.reject(toOcrError(error));
      }
      if (!region) return Promise.resolve(emptyResult(0));
      if (region.width >= size.width && region.height >= size.height) region = null;
    }
    if (supersedePending) this.supersedeQueued();
    return new Promise<OcrResult>((resolve, reject) => {
      this.enqueue(image, size, region, signal, false, resolve, reject);
    });
  }

  async dispose(): Promise<void> {
    this.epoch += 1;
    // A worker that is still starting is terminated when it is ready (see start()); new requests start their own.
    this.starting = null;
    this.warmUpRequest = null;
    const error = new OcrError('disposed', 'The OCR service was disposed');
    for (const job of this.queue.splice(0)) this.settle(job, () => job.reject(error));
    const running = this.running;
    if (running) {
      this.settle(running, () => running.reject(error));
      // Its execution winds down on its own; requests made from now on must not wait for it.
      running.cancelInterrupt();
      this.running = null;
    }
    const slot = this.slot;
    if (slot) await this.discard(slot, error);
  }

  // -- queue ------------------------------------------------------------------------------------

  private enqueue(
    image: Uint8Array,
    size: Size,
    rectangle: Rect | null,
    signal: AbortSignal | undefined,
    internal: boolean,
    resolve: (result: OcrResult) => void,
    reject: (error: Error) => void,
  ): void {
    const interrupt = deferred<never>();
    const job: Job = {
      image,
      size,
      rectangle,
      internal,
      settled: false,
      resolve,
      reject,
      detachSignal: () => undefined,
      interrupt,
      cancelInterrupt: () => undefined,
    };
    if (signal) {
      const onAbort = (): void => {
        this.abort(job);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      job.detachSignal = () => {
        signal.removeEventListener('abort', onAbort);
      };
    }
    this.queue.push(job);
    this.pump();
  }

  private supersedeQueued(): void {
    const error = new OcrError('superseded', 'A newer OCR request replaced this one');
    for (const job of [...this.queue]) {
      if (job.internal) continue;
      this.queue.splice(this.queue.indexOf(job), 1);
      this.settle(job, () => job.reject(error));
    }
  }

  private abort(job: Job): void {
    if (job.settled) return;
    const error = new OcrError('aborted', 'OCR was cancelled');
    this.settle(job, () => job.reject(error));
    if (this.running === job) {
      // The recognition cannot be interrupted; give it a moment to finish, then replace the worker.
      const timer = setTimeout(() => {
        job.interrupt.reject(error);
      }, this.abortGraceMs);
      timer.unref();
      job.cancelInterrupt = () => {
        clearTimeout(timer);
      };
    } else {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
    }
  }

  private settle(job: Job, deliver: () => void): void {
    if (job.settled) return;
    job.settled = true;
    job.detachSignal();
    deliver();
  }

  private pump(): void {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = job;
    void this.execute(job).finally(() => {
      job.cancelInterrupt();
      // dispose() may have detached this job already; a newer one must not be clobbered then
      if (this.running !== job) return;
      this.running = null;
      if (this.queue.length === 0) this.recycleIfLarge();
      this.pump();
    });
  }

  /** Replaces a worker whose memory grew for a large image, while nothing is waiting for it. */
  private recycleIfLarge(): void {
    const slot = this.slot;
    if (!slot || slot.dead || slot.largestImage < this.largeImagePixels) return;
    this.logger.info('Replacing the OCR worker to release memory');
    void this.discard(slot, new OcrError('aborted', 'The OCR worker was recycled'))
      .then(() => this.warmUp())
      .catch(() => undefined);
  }

  // -- execution --------------------------------------------------------------------------------

  private async execute(job: Job): Promise<void> {
    if (job.settled) return;
    const startedAt = performance.now();
    for (let attempt = 0; ; attempt += 1) {
      let slot: WorkerSlot | null = null;
      try {
        slot = await this.acquire();
        if (job.settled) return;
        const page = await this.callWorker(slot, job);
        slot.warmed = true;
        const durationMs = Math.round(performance.now() - startedAt);
        if (job.internal) {
          this.logger.info(`OCR engine warmed up in ${durationMs} ms`);
          this.settle(job, () => job.resolve(emptyResult(durationMs)));
          return;
        }
        slot.largestImage = Math.max(slot.largestImage, job.size.width * job.size.height);
        const result = toResult(
          page,
          { x: 0, y: 0, width: job.size.width, height: job.size.height },
          this.minWordConfidence,
          durationMs,
        );
        this.logger.debug(`OCR found ${result.words.length} words in ${durationMs} ms`);
        this.settle(job, () => job.resolve(result));
        return;
      } catch (caught) {
        const error = toOcrError(caught);
        if (slot && this.shouldReplace(error)) await this.discard(slot, error);
        // Only a worker that was running and died is worth a second try; one that cannot start will not.
        const retry =
          slot !== null &&
          error.code === 'worker-crashed' &&
          attempt < MAX_CRASH_RETRIES &&
          !job.settled;
        if (retry) {
          this.logger.warn('OCR worker crashed, retrying with a new one');
          continue;
        }
        if (!job.settled) this.logger.warn(`OCR failed (${error.code}): ${error.message}`);
        this.settle(job, () => job.reject(error));
        return;
      }
    }
  }

  private shouldReplace(error: OcrError): boolean {
    return (
      error.code === 'timeout' ||
      error.code === 'aborted' ||
      error.code === 'worker-crashed' ||
      FATAL_WORKER_ERROR.test(error.message)
    );
  }

  private async callWorker(slot: WorkerSlot, job: Job): Promise<unknown> {
    const timeout = timeoutGuard(this.timeoutMs, `OCR took longer than ${this.timeoutMs} ms`);
    try {
      return await Promise.race([
        slot.worker.recognize(job.image, job.rectangle ?? undefined),
        slot.lost.promise,
        job.interrupt.promise,
        timeout.promise,
      ]);
    } finally {
      timeout.cancel();
    }
  }

  // -- worker lifecycle -------------------------------------------------------------------------

  private acquire(): Promise<WorkerSlot> {
    if (this.slot && !this.slot.dead) return Promise.resolve(this.slot);
    if (!this.starting) {
      const starting = this.start(this.epoch);
      this.starting = starting;
      const clear = (): void => {
        if (this.starting === starting) this.starting = null;
      };
      starting.then(clear, clear);
    }
    return this.starting;
  }

  private async start(epoch: number): Promise<WorkerSlot> {
    const startedAt = performance.now();
    const guard = timeoutGuard(
      this.timeoutMs,
      `The OCR worker did not start within ${this.timeoutMs} ms`,
    );
    let starting: Promise<OcrWorker> | undefined;
    let worker: OcrWorker;
    try {
      starting = this.factory(this.config);
      worker = await Promise.race([starting, guard.promise]);
    } catch (error) {
      // A worker that finishes starting after we gave up on it must not be left running.
      starting?.then(
        (late) => this.terminateQuietly(late),
        () => undefined,
      );
      throw error;
    } finally {
      guard.cancel();
    }
    if (epoch !== this.epoch) {
      void this.terminateQuietly(worker);
      throw new OcrError('disposed', 'The OCR service was disposed');
    }
    const slot: WorkerSlot = {
      worker,
      dead: false,
      warmed: false,
      largestImage: 0,
      lost: deferred<never>(),
    };
    worker.onCrash((error) => {
      this.handleLost(slot, new OcrError('worker-crashed', error.message, { cause: error }));
    });
    this.slot = slot;
    this.logger.info(`OCR worker started in ${Math.round(performance.now() - startedAt)} ms`);
    return slot;
  }

  private handleLost(slot: WorkerSlot, error: OcrError): void {
    if (slot.dead) return;
    slot.dead = true;
    if (this.slot === slot) this.slot = null;
    slot.lost.reject(error);
  }

  private async discard(slot: WorkerSlot, error: OcrError): Promise<void> {
    this.handleLost(slot, error);
    await this.terminateQuietly(slot.worker);
  }

  private async terminateQuietly(worker: OcrWorker): Promise<void> {
    try {
      await worker.terminate();
    } catch (error) {
      this.logger.warn('OCR worker termination failed', errorText(error));
    }
  }
}

export function createOcrService(options: OcrServiceOptions): OcrService {
  return new OcrEngine(options);
}

import { createHash, type Hash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, type Stats } from 'node:fs';
import { mkdir, open, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { silentLogger, type Logger } from '@shared/logger';
import {
  assertValidManifest,
  modelManifest,
  type ModelManifest,
  type ModelProgress,
  type ModelProgressPhase,
  type ModelStatus,
} from '@shared/models';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_STALL_TIMEOUT_MS = 20_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 15_000;
const BACKOFF_JITTER = 0.25;
const RETRY_AFTER_CAP_MS = 30_000;
const PROGRESS_INTERVAL_MS = 100;
const SPEED_SMOOTHING = 0.3;
/** A dropped connection that still advanced the download this far does not use up an attempt. */
const PROGRESS_RESETS_ATTEMPTS_BYTES = 64 * 1024;
const RENAME_RETRIES = 5;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

const DISK_FULL_CODES = new Set(['ENOSPC', 'EDQUOT', 'EFBIG']);
const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const INTERRUPTED_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
  'UND_ERR_ABORTED',
]);
// Electron's net.fetch reports Chromium error names instead of errno codes.
const OFFLINE_MESSAGE =
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_PROXY_CONNECTION_FAILED/;
const INTERRUPTED_MESSAGE =
  /terminated|aborted|premature close|ERR_CONNECTION_(?:RESET|CLOSED|ABORTED)|ERR_EMPTY_RESPONSE|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_CONTENT_LENGTH_MISMATCH|ERR_NETWORK_CHANGED/i;

type FailureKind =
  | 'offline'
  | 'interrupted'
  | 'checksum'
  | 'http'
  | 'disk-full'
  | 'permission'
  | 'cancelled'
  | 'unknown';

interface FailureDetails {
  status?: number;
  path?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

class ModelError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly details: FailureDetails = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'ModelError';
  }
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 5) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  return error instanceof Error ? error.message : 'Unknown error';
}

function stringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== 'object' || error === null || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function classifyError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  const chain = errorChain(error);
  const failure = (kind: FailureKind, item: unknown, extra: FailureDetails = {}): ModelError =>
    new ModelError(kind, messageOf(item), { ...extra, cause: error });
  for (const item of chain) {
    const code = stringProperty(item, 'code') ?? '';
    const path = stringProperty(item, 'path');
    if (DISK_FULL_CODES.has(code)) return failure('disk-full', item);
    // Socket errors such as "connect EACCES" carry no file path.
    if (PERMISSION_CODES.has(code) && path !== undefined) {
      return failure('permission', item, { path });
    }
    if (OFFLINE_CODES.has(code)) return failure('offline', item);
    if (INTERRUPTED_CODES.has(code)) return failure('interrupted', item);
  }
  const text = chain.map(messageOf).join(' ');
  if (OFFLINE_MESSAGE.test(text)) return failure('offline', error);
  if (INTERRUPTED_MESSAGE.test(text)) return failure('interrupted', error);
  return new ModelError('unknown', chain.map(messageOf).at(-1) ?? 'Unknown error', {
    cause: error,
  });
}

function isRetryable(failure: ModelError): boolean {
  if (failure.kind !== 'http') return true;
  const status = failure.details.status ?? 0;
  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

/** Disk problems and cancellation cannot be fixed by retrying or by trying another source. */
function isFatal(failure: ModelError): boolean {
  return (
    failure.kind === 'disk-full' || failure.kind === 'permission' || failure.kind === 'cancelled'
  );
}

/**
 * Friendly, user-facing explanation of a download failure. Pass `willRetry = false` for a
 * failure that ended the download so the text does not promise another automatic attempt.
 */
export function describeModelError(error: unknown, willRetry = true): string {
  const failure = classifyError(error);
  switch (failure.kind) {
    case 'offline':
      return 'No internet connection';
    case 'interrupted':
      return 'The download was interrupted — it will resume';
    case 'checksum':
      return willRetry
        ? 'The downloaded file is corrupt (checksum mismatch); retrying…'
        : 'The downloaded file is corrupt (checksum mismatch)';
    case 'http':
      return `The download server returned an error (HTTP ${failure.details.status ?? 'unknown'})`;
    case 'disk-full':
      return 'Not enough disk space';
    case 'permission':
      return `Permission denied writing to ${failure.details.path ?? 'the models folder'}`;
    case 'cancelled':
      return 'The download was cancelled — it will resume next time';
    case 'unknown':
      return `The speech model could not be downloaded (${failure.message})`;
  }
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ModelError('cancelled', 'Download cancelled');
}

/** Settles like `promise`, but rejects as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

type StallGuard = <T>(operation: () => Promise<T>) => Promise<T>;

/** Aborts `controller` when a single network operation makes no progress for `timeoutMs`. */
function createStallGuard(controller: AbortController, timeoutMs: number): StallGuard {
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const timer = setTimeout(() => {
      controller.abort(
        new ModelError('interrupted', `No data received for ${Math.round(timeoutMs / 1000)} s`),
      );
    }, timeoutMs);
    timer.unref();
    try {
      return await operation();
    } finally {
      clearTimeout(timer);
    }
  };
}

class SpeedMeter {
  private speed = 0;
  private sampledAt = 0;
  private sampledBytes = 0;

  get bytesPerSecond(): number {
    return this.speed;
  }

  start(now: number, bytes: number): void {
    this.speed = 0;
    this.sampledAt = now;
    this.sampledBytes = bytes;
  }

  sample(now: number, bytes: number): void {
    const seconds = (now - this.sampledAt) / 1000;
    if (seconds <= 0) return;
    const instant = (bytes - this.sampledBytes) / seconds;
    this.speed = this.speed === 0 ? instant : this.speed + SPEED_SMOOTHING * (instant - this.speed);
    this.sampledAt = now;
    this.sampledBytes = bytes;
  }

  reset(): void {
    this.speed = 0;
  }
}

async function statIfExists(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (stringProperty(error, 'code') === 'ENOENT') return null;
    throw error;
  }
}

async function hashFileInto(hash: Hash, path: string, signal: AbortSignal): Promise<void> {
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
}

async function writeFully(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let written = 0;
  while (written < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, written, chunk.byteLength - written);
    written += bytesWritten;
  }
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function contentRangeMatches(response: Response, start: number, total: number): boolean {
  const match = /^bytes (\d+)-\d+\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
  return match !== null && Number(match[1]) === start && Number(match[2]) === total;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

interface VerifiedMarker {
  sha256: string;
  sizeBytes: number;
  mtimeMs: number;
}

function isMarker(value: unknown): value is VerifiedMarker {
  if (typeof value !== 'object' || value === null) return false;
  const marker = value as Record<string, unknown>;
  return (
    typeof marker.sha256 === 'string' &&
    typeof marker.sizeBytes === 'number' &&
    typeof marker.mtimeMs === 'number'
  );
}

/** The part of `fetch` the downloader relies on; the global fetch and Electron's net.fetch fit. */
type ModelFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export interface ModelManagerOptions {
  /** Folder holding the archive, its `.part` file and the `.verified.json` marker. */
  modelsDir: string;
  manifest?: ModelManifest;
  /** Defaults to the global fetch; inject Electron's `net.fetch` to honour system proxies. */
  fetch?: ModelFetch;
  logger?: Logger;
  /** Waits between retries. */
  sleep?: (ms: number) => Promise<void>;
  /** Attempts per download source before the next source is tried. Default 5. */
  maxAttempts?: number;
  now?: () => number;
  /** Jitter source in [0, 1). Default `Math.random`. */
  random?: () => number;
  /** A transfer that receives no bytes for this long is aborted and retried. Default 20 s. */
  stallTimeoutMs?: number;
}

export interface EnsureOptions {
  /** Stops waiting; the download itself is cancelled once no caller is waiting for it. */
  signal?: AbortSignal;
  onProgress?: (progress: ModelProgress) => void;
}

type ProgressListener = (progress: ModelProgress) => void;

interface ActiveRun {
  readonly controller: AbortController;
  readonly done: Promise<ModelStatus>;
  waiters: number;
  cancelled: boolean;
}

interface TransferState {
  hash: Hash;
  received: number;
}

/**
 * Keeps the offline speech model (a `.tar.gz` that the renderer loads through the app protocol)
 * on disk: a resumable, retried, checksum-verified download plus a sidecar marker so that
 * app start never has to hash 40 MB again.
 */
export class ModelManager {
  private readonly manifest: ModelManifest;
  private readonly modelsDir: string;
  private readonly filePath: string;
  private readonly partPath: string;
  private readonly markerPath: string;
  private readonly fetchImpl: ModelFetch;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly stallTimeoutMs: number;
  private readonly listeners = new Set<ProgressListener>();
  private readonly speed = new SpeedMeter();
  private run: ActiveRun | null = null;
  private lastError: string | undefined;
  private receivedBytes = 0;
  private attemptStartBytes = 0;
  private attempt = 1;
  private lastEmitAt = Number.NEGATIVE_INFINITY;

  constructor(options: ModelManagerOptions) {
    this.manifest = options.manifest ?? modelManifest;
    assertValidManifest(this.manifest);
    this.modelsDir = options.modelsDir;
    this.filePath = join(options.modelsDir, this.manifest.fileName);
    this.partPath = `${this.filePath}.part`;
    this.markerPath = `${this.filePath}.verified.json`;
    this.fetchImpl = options.fetch ?? fetch;
    this.logger = options.logger ?? silentLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  }

  /** Absolute path of the archive once it is ready (`<modelsDir>\<fileName>`). */
  getFilePath(): string {
    return this.filePath;
  }

  getStatus(): ModelStatus {
    const totalBytes = this.manifest.sizeBytes;
    if (this.run && !this.run.cancelled) {
      return { state: 'downloading', receivedBytes: this.receivedBytes, totalBytes };
    }
    if (this.isReady()) return { state: 'ready', receivedBytes: totalBytes, totalBytes };
    const idle = this.idleStatus();
    return this.lastError ? { ...idle, state: 'error', message: this.lastError } : idle;
  }

  /**
   * True when the archive has its exact size and the marker written after verification still
   * matches it (size and modification time). Never hashes the file.
   */
  isReady(): boolean {
    try {
      const info = statSync(this.filePath);
      const marker: unknown = JSON.parse(readFileSync(this.markerPath, 'utf8'));
      return (
        info.isFile() &&
        info.size === this.manifest.sizeBytes &&
        isMarker(marker) &&
        marker.sha256 === this.manifest.sha256 &&
        marker.sizeBytes === info.size &&
        marker.mtimeMs === info.mtimeMs
      );
    } catch {
      return false;
    }
  }

  /** Subscribes to progress events (at most about ten per second while downloading). */
  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Makes sure the verified archive is on disk, downloading or resuming it when necessary.
   * Concurrent calls share one download. Never rejects: failures are reported as an `error`
   * status, and an aborted `signal` (or `cancel()`) leaves a resumable `partial` status.
   */
  ensure(options: EnsureOptions = {}): Promise<ModelStatus> {
    const { signal, onProgress } = options;
    if (signal?.aborted) return Promise.resolve(this.idleStatus());
    const unsubscribe = onProgress ? this.onProgress(onProgress) : undefined;
    if (!this.run && this.isReady()) {
      this.emit('ready');
      unsubscribe?.();
      return Promise.resolve(this.getStatus());
    }
    if (this.run?.cancelled) {
      unsubscribe?.();
      return this.run.done.then(() => this.ensure(options));
    }
    const run = this.run ?? this.startRun();
    run.waiters += 1;
    return new Promise<ModelStatus>((resolve) => {
      let waiting = true;
      const leave = (status: ModelStatus): void => {
        if (!waiting) return;
        waiting = false;
        signal?.removeEventListener('abort', onAbort);
        unsubscribe?.();
        run.waiters -= 1;
        resolve(status);
      };
      const onAbort = (): void => {
        leave(this.idleStatus());
        if (run.waiters === 0) this.cancelRun(run);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      void run.done.then(leave);
    });
  }

  /** Stops a running download; the partial file is kept so the next `ensure()` resumes. */
  cancel(): void {
    if (this.run) this.cancelRun(this.run);
  }

  /** Deletes the archive, any partial download and the verification marker. */
  async remove(): Promise<void> {
    if (this.run) {
      this.cancelRun(this.run);
      await this.run.done;
    }
    const paths = [this.filePath, this.partPath, this.markerPath, `${this.markerPath}.tmp`];
    await Promise.all(paths.map((path) => this.discard(path)));
    this.lastError = undefined;
  }

  private idleStatus(): ModelStatus {
    const totalBytes = this.manifest.sizeBytes;
    try {
      return { state: 'partial', receivedBytes: statSync(this.partPath).size, totalBytes };
    } catch {
      return { state: 'missing', receivedBytes: 0, totalBytes };
    }
  }

  private startRun(): ActiveRun {
    const controller = new AbortController();
    const run: ActiveRun = {
      controller,
      waiters: 0,
      cancelled: false,
      // Deferred so that `this.run` is already set when the first progress event is emitted.
      done: Promise.resolve()
        .then(() => this.execute(controller.signal))
        .finally(() => {
          if (this.run === run) this.run = null;
        }),
    };
    this.run = run;
    return run;
  }

  private cancelRun(run: ActiveRun): void {
    if (run.cancelled) return;
    run.cancelled = true;
    run.controller.abort(new ModelError('cancelled', 'Download cancelled'));
  }

  private async execute(signal: AbortSignal): Promise<ModelStatus> {
    this.lastError = undefined;
    this.attempt = 1;
    this.receivedBytes = this.idleStatus().receivedBytes;
    this.speed.reset();
    try {
      this.emit('checking');
      await mkdir(this.modelsDir, { recursive: true });
      if (!(await this.adoptExistingFile(signal))) await this.downloadFromSources(signal);
      return this.finishReady();
    } catch (error) {
      return this.finishFailed(error, signal);
    }
  }

  private finishReady(): ModelStatus {
    const totalBytes = this.manifest.sizeBytes;
    this.receivedBytes = totalBytes;
    this.logger.info('Speech model is ready', this.manifest.id);
    this.emit('ready');
    return { state: 'ready', receivedBytes: totalBytes, totalBytes };
  }

  private finishFailed(error: unknown, signal: AbortSignal): ModelStatus {
    if (signal.aborted) {
      this.logger.info('Speech model download cancelled');
      this.emit('error', describeModelError(abortReason(signal)));
      return this.idleStatus();
    }
    const failure = classifyError(error);
    const message = describeModelError(failure, false);
    this.lastError = message;
    this.logger.error('Speech model download failed', failure);
    this.emit('error', message);
    return { ...this.idleStatus(), state: 'error', message };
  }

  /** Accepts a complete archive that is already in place, verifying it once if needed. */
  private async adoptExistingFile(signal: AbortSignal): Promise<boolean> {
    const info = await statIfExists(this.filePath);
    if (!info) return false;
    if (info.size === this.manifest.sizeBytes) {
      this.receivedBytes = info.size;
      this.emit('verifying');
      const hash = createHash('sha256');
      await hashFileInto(hash, this.filePath, signal);
      if (hash.digest('hex') === this.manifest.sha256) {
        await this.writeMarker();
        return true;
      }
    }
    this.logger.warn('Existing speech model failed verification; downloading it again');
    await Promise.all([this.discard(this.filePath), this.discard(this.markerPath)]);
    this.receivedBytes = 0;
    return false;
  }

  private async downloadFromSources(signal: AbortSignal): Promise<void> {
    let lastFailure: ModelError | undefined;
    for (const url of this.manifest.urls) {
      let failures = 0;
      for (;;) {
        this.attempt = failures + 1;
        try {
          await this.downloadOnce(url, signal);
          return;
        } catch (error) {
          const failure = signal.aborted
            ? new ModelError('cancelled', 'Download cancelled')
            : classifyError(error);
          lastFailure = failure;
          this.speed.reset();
          if (isFatal(failure)) throw failure;
          this.logger.warn('Speech model download attempt failed', url, failure.message);
          if (!isRetryable(failure)) break;
          const advanced = this.receivedBytes - this.attemptStartBytes;
          const madeProgress =
            (failure.kind === 'interrupted' || failure.kind === 'offline') &&
            advanced >= PROGRESS_RESETS_ATTEMPTS_BYTES;
          failures = madeProgress ? 0 : failures + 1;
          if (failures >= this.maxAttempts) break;
          this.attempt = failures + 1;
          this.emit('downloading', describeModelError(failure));
          await raceAbort(
            this.sleep(this.retryDelay(failure, madeProgress ? 0 : failures - 1)),
            signal,
          );
        }
      }
    }
    throw lastFailure ?? new ModelError('unknown', 'No download source is configured');
  }

  private retryDelay(failure: ModelError, exponent: number): number {
    const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
    const jittered = Math.min(BACKOFF_CAP_MS, backoff * (1 + BACKOFF_JITTER * this.random()));
    const requested = Math.min(RETRY_AFTER_CAP_MS, failure.details.retryAfterMs ?? 0);
    return Math.max(jittered, requested);
  }

  /** One attempt: resume or start the `.part` file, verify it and publish it. */
  private async downloadOnce(url: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const state: TransferState = { hash: createHash('sha256'), received: await this.partialSize() };
    this.attemptStartBytes = state.received;
    this.receivedBytes = state.received;
    if (state.received > 0) {
      this.emit('checking');
      await hashFileInto(state.hash, this.partPath, signal);
    }
    if (state.received < this.manifest.sizeBytes) await this.transfer(url, state, signal);
    this.receivedBytes = state.received;
    this.emit('verifying');
    if (state.hash.digest('hex') !== this.manifest.sha256) {
      await this.discard(this.partPath);
      throw new ModelError('checksum', 'SHA-256 of the downloaded file does not match');
    }
    await this.renameWithRetry(this.partPath, this.filePath);
    await this.writeMarker();
  }

  private async partialSize(): Promise<number> {
    const info = await statIfExists(this.partPath);
    if (!info) return 0;
    if (info.size > this.manifest.sizeBytes) {
      await this.discard(this.partPath);
      return 0;
    }
    return info.size;
  }

  private async transfer(url: string, state: TransferState, runSignal: AbortSignal): Promise<void> {
    const attempt = new AbortController();
    const forwardCancel = (): void => attempt.abort(runSignal.reason);
    runSignal.addEventListener('abort', forwardCancel, { once: true });
    const guarded = createStallGuard(attempt, this.stallTimeoutMs);
    let handle: FileHandle | undefined;
    try {
      const response = await this.negotiate(url, state, attempt.signal, guarded);
      const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
        response.body?.getReader();
      if (!reader) throw new ModelError('interrupted', 'The server sent an empty response');
      handle = await open(this.partPath, state.received > 0 ? 'a' : 'w');
      this.logger.info('Downloading speech model', url, 'from byte', state.received);
      this.speed.start(this.now(), state.received);
      this.emit('downloading');
      for (;;) {
        const { done, value } = await guarded(() => reader.read());
        if (done) break;
        if (state.received + value.byteLength > this.manifest.sizeBytes) {
          throw new ModelError('checksum', 'The server sent more data than expected');
        }
        await writeFully(handle, value);
        state.hash.update(value);
        state.received += value.byteLength;
        this.onBytes(state.received);
      }
      if (state.received !== this.manifest.sizeBytes) {
        throw new ModelError(
          'interrupted',
          `Connection closed after ${state.received} of ${this.manifest.sizeBytes} bytes`,
        );
      }
      await handle.sync();
    } catch (error) {
      throw attempt.signal.aborted && attempt.signal.reason instanceof ModelError
        ? attempt.signal.reason
        : error;
    } finally {
      runSignal.removeEventListener('abort', forwardCancel);
      attempt.abort();
      await handle?.close().catch(() => undefined);
    }
  }

  /**
   * Requests the file (resuming from the partial download when possible) and returns the
   * response whose body should be streamed to disk. Restarts from zero when the server ignores
   * or rejects the Range request.
   */
  private async negotiate(
    url: string,
    state: TransferState,
    signal: AbortSignal,
    guarded: StallGuard,
  ): Promise<Response> {
    const total = this.manifest.sizeBytes;
    for (;;) {
      const headers: Record<string, string> = {};
      if (state.received > 0) headers.Range = `bytes=${state.received}-`;
      const doFetch = this.fetchImpl;
      const response = await guarded(() => doFetch(url, { headers, signal }));
      const resumed =
        response.status === 206 && contentRangeMatches(response, state.received, total);
      if (response.status === 200) {
        if (state.received > 0) await this.restart(state);
      } else if (!resumed) {
        await cancelBody(response);
        const failure = new ModelError('http', `HTTP ${response.status}`, {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), this.now()),
        });
        if (state.received === 0 || (response.status !== 416 && response.status !== 206)) {
          throw failure;
        }
        await this.restart(state);
        continue;
      }
      const expected = total - state.received;
      const announced = response.headers.get('content-length');
      if (announced !== null && Number(announced) !== expected) {
        await cancelBody(response);
        throw new ModelError(
          'checksum',
          `The server announced ${announced} bytes but ${expected} were expected`,
        );
      }
      return response;
    }
  }

  private async restart(state: TransferState): Promise<void> {
    await this.discard(this.partPath);
    state.hash = createHash('sha256');
    state.received = 0;
    this.receivedBytes = 0;
  }

  private async writeMarker(): Promise<void> {
    const info = await stat(this.filePath);
    const marker: VerifiedMarker = {
      sha256: this.manifest.sha256,
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs,
    };
    const temp = `${this.markerPath}.tmp`;
    await writeFile(temp, `${JSON.stringify(marker)}\n`, 'utf8');
    await this.renameWithRetry(temp, this.markerPath);
  }

  /** Windows (antivirus, indexers) can briefly lock files, so renames are retried. */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(from, to);
        return;
      } catch (error) {
        const code = stringProperty(error, 'code') ?? '';
        if (!RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRIES) throw error;
        await this.sleep(40 * (attempt + 1));
      }
    }
  }

  private discard(path: string): Promise<void> {
    return rm(path, { force: true, maxRetries: 3, retryDelay: 50 });
  }

  private onBytes(received: number): void {
    this.receivedBytes = received;
    const now = this.now();
    if (now - this.lastEmitAt < PROGRESS_INTERVAL_MS) return;
    this.speed.sample(now, received);
    this.emit('downloading');
  }

  private emit(phase: ModelProgressPhase, message?: string): void {
    this.lastEmitAt = this.now();
    const totalBytes = this.manifest.sizeBytes;
    const bytesPerSecond = phase === 'downloading' ? Math.round(this.speed.bytesPerSecond) : 0;
    const progress: ModelProgress = {
      phase,
      receivedBytes: phase === 'ready' ? totalBytes : this.receivedBytes,
      totalBytes,
      bytesPerSecond,
      etaSeconds:
        bytesPerSecond > 0
          ? Math.ceil(Math.max(0, totalBytes - this.receivedBytes) / bytesPerSecond)
          : null,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
    };
    if (message !== undefined) progress.message = message;
    for (const listener of [...this.listeners]) {
      try {
        listener(progress);
      } catch (error) {
        this.logger.warn('Model progress listener failed', error);
      }
    }
  }
}

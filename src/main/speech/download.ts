import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '@shared/logger';

export type DownloadErrorKind =
  'offline' | 'http' | 'integrity' | 'disk' | 'permission' | 'cancelled' | 'incomplete';

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly kind: DownloadErrorKind,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadRequest {
  url: string;
  /** Final path. The data is written to `<target>.part` first and verified before the rename. */
  target: string;
  bytes: number;
  sha256: string;
  fetch: typeof fetch;
  signal: AbortSignal;
  /** Bytes of this file received so far (including a resumed part). */
  onProgress: (received: number) => void;
  maxAttempts?: number;
  stallTimeoutMs?: number;
  /** Delay before retry `attempt` (1-based); injectable for tests. */
  backoffMs?: (attempt: number) => number;
  logger?: Logger;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_STALL_MS = 20_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'ERR_NETWORK_CHANGED',
  'ERR_INTERNET_DISCONNECTED',
]);
const DISK_CODES = new Set(['ENOSPC', 'EDQUOT', 'EFBIG']);
const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

function codeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function describeDownloadError(error: unknown): string {
  if (error instanceof DownloadError) return error.message;
  return 'The download failed. Please try again.';
}

function classify(error: unknown, stalled: boolean): DownloadError {
  if (error instanceof DownloadError) return error;
  const code = codeOf(error);
  if (code && DISK_CODES.has(code)) {
    return new DownloadError(
      'There is not enough free disk space for this download.',
      'disk',
      false,
    );
  }
  if (code && PERMISSION_CODES.has(code)) {
    return new DownloadError('Beekeeper cannot write to its models folder.', 'permission', false);
  }
  if (stalled) {
    return new DownloadError('The download stalled. Retrying…', 'offline', true);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new DownloadError('The download was cancelled.', 'cancelled', false);
  }
  if ((code && NETWORK_CODES.has(code)) || error instanceof TypeError) {
    return new DownloadError(
      'Beekeeper could not reach the download server. Check your internet connection.',
      'offline',
      true,
    );
  }
  return new DownloadError('The download was interrupted. Retrying…', 'incomplete', true);
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function feedHash(hash: ReturnType<typeof createHash>, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DownloadError('The download was cancelled.', 'cancelled', false));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DownloadError('The download was cancelled.', 'cancelled', false));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function attempt(request: DownloadRequest): Promise<void> {
  const { url, target, bytes, sha256, signal } = request;
  if (signal.aborted) throw new DownloadError('The download was cancelled.', 'cancelled', false);
  const part = `${target}.part`;
  const stallMs = request.stallTimeoutMs ?? DEFAULT_STALL_MS;

  let have = await sizeOf(part);
  if (have > bytes) {
    await rm(part, { force: true });
    have = 0;
  }
  const hash = { current: createHash('sha256') };
  if (have > 0) await feedHash(hash.current, part);

  const stall = new AbortController();
  let stalled = false;
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      stall.abort();
    }, stallMs);
  };
  const combined = AbortSignal.any([signal, stall.signal]);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    arm();
    const response = await request.fetch(url, {
      signal: combined,
      headers: have > 0 ? { Range: `bytes=${have}-` } : {},
    });

    if (response.status === 416 && have === bytes) {
      await response.body?.cancel().catch(() => undefined);
    } else if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DownloadError(
        `The download server answered with HTTP ${response.status}.`,
        'http',
        RETRYABLE_STATUSES.has(response.status),
      );
    } else {
      if (response.status === 200 && have > 0) {
        // The server ignored the Range header and sends the whole file: start over.
        await rm(part, { force: true });
        have = 0;
        hash.current = createHash('sha256');
      }
      if (!response.body) throw new DownloadError('The download had no data.', 'incomplete', true);

      handle = await open(part, have > 0 ? 'a' : 'w');
      let received = have;
      request.onProgress(received);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done || !value) break;
        arm();
        hash.current.update(value);
        await handle.write(value);
        received += value.byteLength;
        request.onProgress(received);
      }
      await handle.close();
      handle = undefined;
      have = received;
    }

    if (have !== bytes) {
      throw new DownloadError('The download ended early. Retrying…', 'incomplete', true);
    }
    if (hash.current.digest('hex') !== sha256) {
      await rm(part, { force: true });
      throw new DownloadError(
        'The downloaded file did not match its checksum and was discarded.',
        'integrity',
        true,
      );
    }
    await rename(part, target);
  } catch (error) {
    if (signal.aborted) throw new DownloadError('The download was cancelled.', 'cancelled', false);
    throw classify(error, stalled);
  } finally {
    clearTimeout(timer);
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Downloads one file with resume, stall detection, retries with backoff and a SHA-256 check.
 * A verified file replaces the target atomically; a partial file is kept so a retry (or the next
 * start of the app) continues where it stopped.
 */
export async function downloadVerified(request: DownloadRequest): Promise<void> {
  await mkdir(dirname(request.target), { recursive: true });
  const maxAttempts = request.maxAttempts ?? DEFAULT_ATTEMPTS;
  const backoff = request.backoffMs ?? ((n: number) => Math.min(15_000, 1000 * 2 ** (n - 1)));

  for (let attemptNumber = 1; ; attemptNumber += 1) {
    try {
      await attempt(request);
      return;
    } catch (error) {
      const failure = error instanceof DownloadError ? error : classify(error, false);
      if (failure.kind === 'cancelled' || !failure.retryable || attemptNumber >= maxAttempts) {
        throw failure;
      }
      request.logger?.warn(`Download attempt ${attemptNumber} failed (${failure.kind})`);
      await sleep(backoff(attemptNumber), request.signal);
    }
  }
}

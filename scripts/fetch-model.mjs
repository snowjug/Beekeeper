#!/usr/bin/env node
// Downloads and verifies the offline speech model described by src/shared/model-manifest.json.
// Resumes partial downloads, retries with backoff, falls back to the next mirror and writes the
// same `.verified.json` marker as the app's ModelManager, so the app accepts the file as is.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_MANIFEST = fileURLToPath(
  new URL('../src/shared/model-manifest.json', import.meta.url),
);
const MAX_ATTEMPTS = 5;
const STALL_TIMEOUT_MS = 20_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 15_000;
const BACKOFF_JITTER = 0.25;
const RETRY_AFTER_CAP_MS = 30_000;
const PROGRESS_RESETS_ATTEMPTS_BYTES = 64 * 1024;
const RETRYABLE_STATUSES = new Set([408, 425, 429]);
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
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

const USAGE = `Usage: node scripts/fetch-model.mjs [options]

Downloads the offline speech model into the folder the app reads it from.

Options:
  --dir <folder>      Target folder (default: %APPDATA%\\Beekeeper\\models)
  --manifest <file>   Manifest to use (default: src/shared/model-manifest.json)
  --force             Download again even when a verified copy exists
  -h, --help          Show this help

Exit code: 0 when the model is present and verified, 1 otherwise.`;

/** `action` tells the retry loop what to do next: try again, skip this mirror or give up. */
class FetchError extends Error {
  constructor(action, message, { cause, retryAfterMs, interrupted = false } = {}) {
    super(message, { cause });
    this.name = 'FetchError';
    this.action = action;
    this.retryAfterMs = retryAfterMs;
    this.interrupted = interrupted;
  }
}

function log(message) {
  console.log(message);
}

function formatBytes(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function defaultModelsDir() {
  return join(process.env.APPDATA ?? join(homedir(), '.config'), 'Beekeeper', 'models');
}

async function loadManifest(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const valid =
    typeof manifest.displayName === 'string' &&
    /^[A-Za-z0-9._-]+\.tar\.gz$/.test(manifest.fileName) &&
    /^[0-9a-f]{64}$/.test(manifest.sha256) &&
    Number.isSafeInteger(manifest.sizeBytes) &&
    manifest.sizeBytes > 0 &&
    Array.isArray(manifest.urls) &&
    manifest.urls.length > 0 &&
    manifest.urls.every((url) => typeof url === 'string');
  if (!valid) throw new Error(`Invalid model manifest: ${path}`);
  return manifest;
}

function errorChain(error) {
  const chain = [];
  for (let item = error; item && chain.length < 5; item = item.cause) chain.push(item);
  return chain;
}

function classify(error) {
  if (error instanceof FetchError) return error;
  const chain = errorChain(error);
  for (const item of chain) {
    const code = typeof item.code === 'string' ? item.code : '';
    if (DISK_FULL_CODES.has(code)) {
      return new FetchError('fatal', 'Not enough disk space', { cause: error });
    }
    if (PERMISSION_CODES.has(code) && typeof item.path === 'string') {
      return new FetchError('fatal', `Permission denied writing to ${item.path}`, { cause: error });
    }
    if (OFFLINE_CODES.has(code)) {
      return new FetchError('retry', 'No internet connection', { cause: error, interrupted: true });
    }
    if (INTERRUPTED_CODES.has(code)) {
      return new FetchError('retry', 'The download was interrupted — it will resume', {
        cause: error,
        interrupted: true,
      });
    }
  }
  const text = chain.map((item) => String(item?.message ?? item)).join(' ');
  if (/terminated|aborted/i.test(text)) {
    return new FetchError('retry', 'The download was interrupted — it will resume', {
      cause: error,
      interrupted: true,
    });
  }
  return new FetchError('retry', `Download failed (${text || 'unknown error'})`, { cause: error });
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function retryDelay(failure, exponent) {
  const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const jittered = Math.min(BACKOFF_CAP_MS, backoff * (1 + BACKOFF_JITTER * Math.random()));
  return Math.max(jittered, Math.min(RETRY_AFTER_CAP_MS, failure.retryAfterMs ?? 0));
}

function sleep(ms, signal) {
  return new Promise((resolveSleep, rejectSleep) => {
    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveSleep();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Aborts `controller` when one network operation makes no progress for STALL_TIMEOUT_MS. */
function stallGuard(controller) {
  return async (operation) => {
    const timer = setTimeout(
      () =>
        controller.abort(new FetchError('retry', 'The download stalled', { interrupted: true })),
      STALL_TIMEOUT_MS,
    );
    try {
      return await operation();
    } finally {
      clearTimeout(timer);
    }
  };
}

async function statIfExists(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function hashFileInto(hash, path, signal) {
  for await (const chunk of createReadStream(path, { signal, highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
  }
}

async function writeFully(handle, chunk) {
  let written = 0;
  while (written < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, written, chunk.byteLength - written);
    written += bytesWritten;
  }
}

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error?.code) || attempt >= 5) throw error;
      await new Promise((done) => setTimeout(done, 40 * (attempt + 1)));
    }
  }
}

async function isVerified(paths, manifest) {
  try {
    const info = await stat(paths.file);
    const marker = JSON.parse(await readFile(paths.marker, 'utf8'));
    return (
      info.isFile() &&
      info.size === manifest.sizeBytes &&
      marker.sha256 === manifest.sha256 &&
      marker.sizeBytes === info.size &&
      marker.mtimeMs === info.mtimeMs
    );
  } catch {
    return false;
  }
}

async function writeMarker(paths, manifest) {
  const info = await stat(paths.file);
  const marker = { sha256: manifest.sha256, sizeBytes: info.size, mtimeMs: info.mtimeMs };
  await writeFile(`${paths.marker}.tmp`, `${JSON.stringify(marker)}\n`, 'utf8');
  await renameWithRetry(`${paths.marker}.tmp`, paths.marker);
}

/** Single-line progress bar on a terminal, one line per 10 % otherwise. */
function createProgress(total) {
  const interactive = process.stdout.isTTY === true;
  let speed = 0;
  let sampledAt = 0;
  let sampledBytes = 0;
  let printedAt = 0;
  let decile = 0;
  let lineOpen = false;

  const line = (received) => {
    const fraction = Math.min(1, received / total);
    const filled = Math.round(fraction * 28);
    const eta = speed > 0 ? `${Math.ceil((total - received) / speed)}s` : '--';
    return (
      `[${'#'.repeat(filled)}${'-'.repeat(28 - filled)}] ${String(Math.floor(fraction * 100)).padStart(3)}%` +
      `  ${formatBytes(received)} / ${formatBytes(total)}  ${formatBytes(speed)}/s  ETA ${eta}`
    );
  };

  return {
    begin(received) {
      speed = 0;
      sampledAt = Date.now();
      sampledBytes = received;
      decile = Math.floor((received / total) * 10);
    },
    update(received) {
      const now = Date.now();
      if (now - sampledAt >= 250) {
        const instant = ((received - sampledBytes) * 1000) / (now - sampledAt);
        speed = speed === 0 ? instant : speed + 0.3 * (instant - speed);
        sampledAt = now;
        sampledBytes = received;
      }
      if (interactive) {
        if (now - printedAt >= 100 || received >= total) {
          printedAt = now;
          lineOpen = true;
          process.stdout.write(`\r${line(received)}  `);
        }
      } else if (Math.floor((received / total) * 10) > decile) {
        decile = Math.floor((received / total) * 10);
        log(line(received));
      }
    },
    end() {
      if (lineOpen) process.stdout.write('\n');
      lineOpen = false;
    },
  };
}

async function negotiate(url, ctx, signal, guarded) {
  const { manifest, state } = ctx;
  const total = manifest.sizeBytes;
  for (;;) {
    const headers = state.received > 0 ? { Range: `bytes=${state.received}-` } : {};
    const response = await guarded(() => fetch(url, { headers, signal }));
    const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    const resumable =
      response.status === 206 &&
      range !== null &&
      Number(range[1]) === state.received &&
      Number(range[2]) === total;
    if (response.status === 200) {
      if (state.received > 0) {
        log('The server ignored the resume request; starting over.');
        await restart(ctx);
      }
    } else if (!resumable) {
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status >= 500 || RETRYABLE_STATUSES.has(response.status);
      const failure = new FetchError(
        retryable ? 'retry' : 'skip',
        `The download server returned an error (HTTP ${response.status})`,
        { retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) },
      );
      if (state.received === 0 || (response.status !== 416 && response.status !== 206)) {
        throw failure;
      }
      log('The server rejected the resume request; starting over.');
      await restart(ctx);
      continue;
    }
    const expected = total - state.received;
    const announced = response.headers.get('content-length');
    if (announced !== null && Number(announced) !== expected) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchError(
        'retry',
        `The server announced ${announced} bytes but ${expected} were expected`,
      );
    }
    return response;
  }
}

async function restart(ctx) {
  await rm(ctx.paths.part, { force: true });
  ctx.state.hash = createHash('sha256');
  ctx.state.received = 0;
}

async function transfer(url, ctx) {
  const { manifest, paths, state, progress } = ctx;
  const attempt = new AbortController();
  const forwardCancel = () => attempt.abort(ctx.signal.reason);
  ctx.signal.addEventListener('abort', forwardCancel, { once: true });
  const guarded = stallGuard(attempt);
  let handle;
  try {
    const response = await negotiate(url, ctx, attempt.signal, guarded);
    const reader = response.body?.getReader();
    if (!reader) throw new FetchError('retry', 'The server sent an empty response');
    handle = await open(paths.part, state.received > 0 ? 'a' : 'w');
    progress.begin(state.received);
    for (;;) {
      const { done, value } = await guarded(() => reader.read());
      if (done) break;
      if (state.received + value.byteLength > manifest.sizeBytes) {
        throw new FetchError('retry', 'The server sent more data than expected');
      }
      await writeFully(handle, value);
      state.hash.update(value);
      state.received += value.byteLength;
      progress.update(state.received);
    }
    progress.update(state.received);
    if (state.received !== manifest.sizeBytes) {
      throw new FetchError('retry', 'The download was interrupted — it will resume', {
        interrupted: true,
      });
    }
    await handle.sync();
  } catch (error) {
    throw attempt.signal.aborted && attempt.signal.reason instanceof FetchError
      ? attempt.signal.reason
      : error;
  } finally {
    ctx.signal.removeEventListener('abort', forwardCancel);
    attempt.abort();
    await handle?.close().catch(() => undefined);
  }
}

async function downloadOnce(url, ctx) {
  const { manifest, paths, state, signal } = ctx;
  signal.throwIfAborted();
  const partial = await statIfExists(paths.part);
  if (partial && partial.size > manifest.sizeBytes) await rm(paths.part, { force: true });
  state.received = partial && partial.size <= manifest.sizeBytes ? partial.size : 0;
  state.hash = createHash('sha256');
  ctx.startBytes = state.received;
  if (state.received > 0) {
    const percent = Math.floor((state.received / manifest.sizeBytes) * 100);
    log(`Resuming from ${formatBytes(state.received)} (${percent}%)`);
    await hashFileInto(state.hash, paths.part, signal);
  }
  if (state.received < manifest.sizeBytes) await transfer(url, ctx);
  if (state.hash.digest('hex') !== manifest.sha256) {
    await rm(paths.part, { force: true });
    throw new FetchError('retry', 'The downloaded file is corrupt (checksum mismatch); retrying…');
  }
  await renameWithRetry(paths.part, paths.file);
  await writeMarker(paths, manifest);
}

async function downloadFromSources(ctx) {
  let lastFailure;
  for (const url of ctx.manifest.urls) {
    log(`Source: ${url}`);
    let failures = 0;
    for (;;) {
      try {
        await downloadOnce(url, ctx);
        return;
      } catch (error) {
        ctx.signal.throwIfAborted();
        ctx.progress.end();
        const failure = classify(error);
        lastFailure = failure;
        log(`  ${failure.message}`);
        if (failure.action === 'fatal') throw failure;
        if (failure.action === 'skip') break;
        const advanced = ctx.state.received - ctx.startBytes;
        const madeProgress = failure.interrupted && advanced >= PROGRESS_RESETS_ATTEMPTS_BYTES;
        failures = madeProgress ? 0 : failures + 1;
        if (failures >= MAX_ATTEMPTS) break;
        const delay = retryDelay(failure, madeProgress ? 0 : failures - 1);
        log(`  Attempt ${failures + 1} of ${MAX_ATTEMPTS} in ${(delay / 1000).toFixed(1)} s`);
        await sleep(delay, ctx.signal);
      }
    }
  }
  throw lastFailure ?? new FetchError('fatal', 'No download source is configured');
}

/** Accepts a complete file that is already in place, verifying it once. */
async function adoptExisting(ctx) {
  const { manifest, paths, signal } = ctx;
  const info = await statIfExists(paths.file);
  if (!info) return false;
  if (info.size === manifest.sizeBytes) {
    log('Verifying the existing file…');
    const hash = createHash('sha256');
    await hashFileInto(hash, paths.file, signal);
    if (hash.digest('hex') === manifest.sha256) {
      await writeMarker(paths, manifest);
      return true;
    }
  }
  log('The existing file is not the expected model; downloading it again.');
  await rm(paths.file, { force: true });
  await rm(paths.marker, { force: true });
  return false;
}

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      manifest: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    log(USAGE);
    return 0;
  }

  const manifest = await loadManifest(resolve(values.manifest ?? DEFAULT_MANIFEST));
  const dir = resolve(values.dir ?? defaultModelsDir());
  const file = join(dir, manifest.fileName);
  const paths = { file, part: `${file}.part`, marker: `${file}.verified.json` };
  log(`${manifest.displayName} (${formatBytes(manifest.sizeBytes)})`);
  log(`Target: ${file}`);
  await mkdir(dir, { recursive: true });

  if (values.force) {
    await Promise.all(
      [paths.file, paths.part, paths.marker].map((path) => rm(path, { force: true })),
    );
  } else if (await isVerified(paths, manifest)) {
    log('The model is already present and verified.');
    return 0;
  }

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort(new Error('Interrupted')));
  const ctx = {
    manifest,
    paths,
    signal: controller.signal,
    state: { hash: createHash('sha256'), received: 0 },
    startBytes: 0,
    progress: createProgress(manifest.sizeBytes),
  };
  try {
    if (!(await adoptExisting(ctx))) await downloadFromSources(ctx);
  } catch (error) {
    ctx.progress.end();
    if (controller.signal.aborted) {
      console.error('Interrupted. Run the command again to resume where it stopped.');
    } else {
      console.error(`Download failed: ${classify(error).message}`);
    }
    return 1;
  }
  ctx.progress.end();
  log(`Done. The model is verified (SHA-256 ${manifest.sha256.slice(0, 12)}…).`);
  return 0;
}

function flush(stream) {
  return new Promise((done) => stream.write('', done));
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (String(error?.code).startsWith('ERR_PARSE_ARGS')) console.error(`\n${USAGE}`);
}
await Promise.all([flush(process.stdout), flush(process.stderr)]);
process.exit(exitCode);

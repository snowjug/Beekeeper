import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechPackState } from '@shared/ipc/types';
import type { Logger } from '@shared/logger';
import {
  SPEECH_PACK_IDS,
  SPEECH_PACKS,
  type SpeechPackId,
  type SpeechPackSpec,
} from '@shared/speech/packs';
import { describeDownloadError, DownloadError, downloadVerified } from './download';

export type ArchiveExtractor = (
  archivePath: string,
  destination: string,
  signal: AbortSignal,
) => Promise<void>;

const MARKER = 'pack.json';
const PROGRESS_INTERVAL_MS = 150;
const SPEED_SMOOTHING = 0.3;

/** Extracts a .tar.bz2 with the bsdtar that ships with Windows 10 and later (System32\tar.exe). */
export const extractWithWindowsTar: ArchiveExtractor = (archivePath, destination, signal) =>
  new Promise((resolve, reject) => {
    const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFile(
      tar,
      ['-xjf', archivePath, '-C', destination],
      { windowsHide: true, timeout: 300_000, signal },
      (error) => {
        if (error) reject(new Error(`tar failed: ${error.message}`, { cause: error }));
        else resolve();
      },
    );
  });

interface Runtime {
  state: SpeechPackState['state'];
  receivedBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  message: string | undefined;
  run: { abort: AbortController; promise: Promise<void> } | null;
  lastSample: { at: number; bytes: number } | null;
}

export interface SpeechPackManagerOptions {
  /** Folder that holds one sub-folder per pack. */
  rootDir: string;
  fetch: typeof fetch;
  logger: Logger;
  extract?: ArchiveExtractor;
  specs?: Readonly<Record<SpeechPackId, SpeechPackSpec>>;
  now?: () => number;
  backoffMs?: (attempt: number) => number;
}

function expectedFiles(spec: SpeechPackSpec): Array<{ name: string; bytes: number }> {
  if (spec.archive) {
    return Object.entries(spec.archive.files).map(([name, bytes]) => ({ name, bytes }));
  }
  return (spec.files ?? []).map((file) => ({ name: file.name, bytes: file.bytes }));
}

function sha256Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Downloads, verifies and tracks the speech packs (natural voice, Whisper models). Every file is
 * checked against a pinned SHA-256; an interrupted download resumes from its partial file.
 */
export class SpeechPackManager {
  private readonly specs: Readonly<Record<SpeechPackId, SpeechPackSpec>>;
  private readonly runtimes = new Map<SpeechPackId, Runtime>();
  private readonly listeners = new Set<() => void>();
  private lastEmit = 0;
  private readonly now: () => number;

  constructor(private readonly options: SpeechPackManagerOptions) {
    this.specs = options.specs ?? SPEECH_PACKS;
    this.now = options.now ?? Date.now;
    for (const id of SPEECH_PACK_IDS) {
      this.runtimes.set(id, {
        state: this.verifiedOnDisk(id) ? 'ready' : 'missing',
        receivedBytes: 0,
        bytesPerSecond: 0,
        etaSeconds: null,
        message: undefined,
        run: null,
        lastSample: null,
      });
    }
  }

  dir(id: SpeechPackId): string {
    return join(this.options.rootDir, id);
  }

  isReady(id: SpeechPackId): boolean {
    return this.runtime(id).state === 'ready';
  }

  readyPacks(): SpeechPackId[] {
    return SPEECH_PACK_IDS.filter((id) => this.isReady(id));
  }

  status(): Record<SpeechPackId, SpeechPackState> {
    const entries = SPEECH_PACK_IDS.map((id): [SpeechPackId, SpeechPackState] => {
      const runtime = this.runtime(id);
      const total = this.specs[id].sizeBytes;
      return [
        id,
        {
          id,
          state: runtime.state,
          receivedBytes: runtime.state === 'ready' ? total : runtime.receivedBytes,
          totalBytes: total,
          bytesPerSecond: runtime.bytesPerSecond,
          etaSeconds: runtime.etaSeconds,
          ...(runtime.message ? { message: runtime.message } : {}),
        },
      ];
    });
    return Object.fromEntries(entries) as Record<SpeechPackId, SpeechPackState>;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts (or joins) the download of a pack. Never rejects: failures are reported in the state. */
  ensure(id: SpeechPackId): Promise<void> {
    const runtime = this.runtime(id);
    if (runtime.state === 'ready') return Promise.resolve();
    if (runtime.run) return runtime.run.promise;

    const abort = new AbortController();
    runtime.state = 'downloading';
    runtime.receivedBytes = 0;
    runtime.bytesPerSecond = 0;
    runtime.etaSeconds = null;
    runtime.message = undefined;
    runtime.lastSample = null;

    const promise = this.install(id, abort.signal)
      .then(() => {
        runtime.state = 'ready';
        runtime.message = undefined;
      })
      .catch((error: unknown) => {
        const cancelled = error instanceof DownloadError && error.kind === 'cancelled';
        runtime.state = cancelled ? 'missing' : 'error';
        runtime.message = cancelled ? undefined : this.describe(error);
        if (!cancelled) this.options.logger.warn(`Speech pack ${id} failed`, error);
      })
      .finally(() => {
        runtime.run = null;
        runtime.bytesPerSecond = 0;
        runtime.etaSeconds = null;
        this.emit(true);
      });
    runtime.run = { abort, promise };
    this.emit(true);
    return promise;
  }

  cancel(id: SpeechPackId): void {
    this.runtime(id).run?.abort.abort();
  }

  async remove(id: SpeechPackId): Promise<void> {
    const runtime = this.runtime(id);
    if (runtime.run) {
      runtime.run.abort.abort();
      await runtime.run.promise;
    }
    await rm(this.dir(id), { recursive: true, force: true });
    await rm(join(this.options.rootDir, '.downloads', id), { recursive: true, force: true });
    runtime.state = 'missing';
    runtime.receivedBytes = 0;
    runtime.message = undefined;
    this.emit(true);
  }

  /** Aborts every running download (application quit). */
  dispose(): void {
    for (const id of SPEECH_PACK_IDS) this.cancel(id);
    this.listeners.clear();
  }

  private runtime(id: SpeechPackId): Runtime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`Unknown speech pack: ${id}`);
    return runtime;
  }

  private describe(error: unknown): string {
    if (error instanceof DownloadError) return describeDownloadError(error);
    if (error instanceof Error && error.message.startsWith('Pack ')) return error.message;
    return 'The download could not be completed. Please try again.';
  }

  /** True when the marker exists and every expected file is present with the expected size. */
  private verifiedOnDisk(id: SpeechPackId): boolean {
    const dir = this.dir(id);
    if (!existsSync(join(dir, MARKER))) return false;
    return expectedFiles(this.specs[id]).every((file) => {
      try {
        return statSync(join(dir, file.name)).size === file.bytes;
      } catch {
        return false;
      }
    });
  }

  private async install(id: SpeechPackId, signal: AbortSignal): Promise<void> {
    const spec = this.specs[id];
    const dir = this.dir(id);
    await mkdir(this.options.rootDir, { recursive: true });
    await rm(join(dir, MARKER), { force: true });

    if (spec.archive) await this.installArchive(id, spec, signal);
    else await this.installFiles(id, spec, signal);

    await writeFile(
      join(dir, MARKER),
      JSON.stringify({ version: 1, id, files: expectedFiles(spec) }, null, 2),
    );
    if (!this.verifiedOnDisk(id)) throw new Error(`Pack ${id} is incomplete after installing`);
  }

  private async installFiles(
    id: SpeechPackId,
    spec: SpeechPackSpec,
    signal: AbortSignal,
  ): Promise<void> {
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true });
    let completed = 0;
    for (const file of spec.files ?? []) {
      const target = join(dir, file.name);
      if (await this.alreadyValid(target, file.bytes, file.sha256)) {
        completed += file.bytes;
        this.progress(id, completed);
        continue;
      }
      const base = completed;
      await downloadVerified({
        url: file.url,
        target,
        bytes: file.bytes,
        sha256: file.sha256,
        fetch: this.options.fetch,
        signal,
        logger: this.options.logger,
        ...(this.options.backoffMs ? { backoffMs: this.options.backoffMs } : {}),
        onProgress: (received) => this.progress(id, base + received),
      });
      completed += file.bytes;
    }
  }

  private async installArchive(
    id: SpeechPackId,
    spec: SpeechPackSpec,
    signal: AbortSignal,
  ): Promise<void> {
    const archive = spec.archive;
    if (!archive) return;
    const work = join(this.options.rootDir, '.downloads', id);
    const archivePath = join(work, 'pack.tar.bz2');
    await mkdir(work, { recursive: true });

    await downloadVerified({
      url: archive.url,
      target: archivePath,
      bytes: archive.bytes,
      sha256: archive.sha256,
      fetch: this.options.fetch,
      signal,
      logger: this.options.logger,
      ...(this.options.backoffMs ? { backoffMs: this.options.backoffMs } : {}),
      onProgress: (received) => this.progress(id, received),
    });

    this.setPhase(id, 'extracting');
    const unpacked = join(work, 'unpacked');
    await rm(unpacked, { recursive: true, force: true });
    await mkdir(unpacked, { recursive: true });
    try {
      await (this.options.extract ?? extractWithWindowsTar)(archivePath, unpacked, signal);
    } catch (error) {
      if (signal.aborted) {
        throw new DownloadError('The download was cancelled.', 'cancelled', false);
      }
      throw error;
    }

    const source = await this.findPackRoot(unpacked, archive.files);
    const target = this.dir(id);
    await rm(target, { recursive: true, force: true });
    await rename(source, target);
    await rm(work, { recursive: true, force: true });
  }

  /** The archive has one top-level folder; accept the files at the top level too. */
  private async findPackRoot(
    unpacked: string,
    files: Readonly<Record<string, number>>,
  ): Promise<string> {
    const complete = async (folder: string): Promise<boolean> => {
      for (const [name, bytes] of Object.entries(files)) {
        try {
          if ((await stat(join(folder, name))).size !== bytes) return false;
        } catch {
          return false;
        }
      }
      return true;
    };
    if (await complete(unpacked)) return unpacked;
    for (const entry of await readdir(unpacked, { withFileTypes: true })) {
      const folder = join(unpacked, entry.name);
      if (entry.isDirectory() && (await complete(folder))) return folder;
    }
    throw new Error('Pack archive did not contain the expected files');
  }

  private async alreadyValid(path: string, bytes: number, sha256: string): Promise<boolean> {
    try {
      if ((await stat(path)).size !== bytes) return false;
      if ((await sha256Of(path)) === sha256) return true;
      await rm(path, { force: true });
      return false;
    } catch {
      return false;
    }
  }

  private setPhase(id: SpeechPackId, phase: 'extracting'): void {
    const runtime = this.runtime(id);
    runtime.state = phase;
    runtime.bytesPerSecond = 0;
    runtime.etaSeconds = null;
    this.emit(true);
  }

  private progress(id: SpeechPackId, received: number): void {
    const runtime = this.runtime(id);
    const now = this.now();
    runtime.receivedBytes = received;
    const last = runtime.lastSample;
    if (!last) {
      runtime.lastSample = { at: now, bytes: received };
    } else if (now - last.at >= 400) {
      const instant = ((received - last.bytes) / (now - last.at)) * 1000;
      runtime.bytesPerSecond =
        runtime.bytesPerSecond === 0
          ? instant
          : runtime.bytesPerSecond * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING;
      runtime.lastSample = { at: now, bytes: received };
      const remaining = Math.max(0, this.specs[id].sizeBytes - received);
      runtime.etaSeconds =
        runtime.bytesPerSecond > 1 ? Math.ceil(remaining / runtime.bytesPerSecond) : null;
    }
    this.emit(false);
  }

  private emit(force: boolean): void {
    const now = this.now();
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return;
    this.lastEmit = now;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.options.logger.warn('Speech pack listener failed', error);
      }
    }
  }
}

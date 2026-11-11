import { randomUUID } from 'node:crypto';
import { silentLogger, type Logger } from '@shared/logger';
import type { TimerRecord, TimersService } from '../commands/types';
import { JsonStore } from './jsonStore';

export type SetTimer = (fn: () => void, ms: number) => unknown;
export type ClearTimer = (handle: unknown) => void;

/** Node timer that never keeps the process alive on its own. */
export const defaultSetTimer: SetTimer = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return handle;
};

export const defaultClearTimer: ClearTimer = (handle) => {
  clearTimeout(handle as NodeJS.Timeout);
};

/** Longest delay setTimeout supports (2^31 - 1 ms, about 24.8 days). */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** How long fired records stay on disk so a finished timer card can still be shown. */
const DONE_RETENTION_MS = 60 * 60 * 1000;
const MAX_LABEL_LENGTH = 200;

const DEFAULT_LABELS: Readonly<Record<TimerRecord['type'], string>> = {
  timer: 'Timer',
  alarm: 'Alarm',
  reminder: 'Reminder',
};

export interface StoredTimer extends TimerRecord {
  /** Epoch ms at which the record fired; used to prune finished records. */
  firedAt?: number;
}

export interface TimersFile {
  version: 1;
  records: StoredTimer[];
}

export function emptyTimersFile(): TimersFile {
  return { version: 1, records: [] };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toStoredTimer(value: unknown): StoredTimer | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    item.id === '' ||
    typeof item.label !== 'string' ||
    (item.type !== 'timer' && item.type !== 'alarm' && item.type !== 'reminder') ||
    (item.state !== 'running' && item.state !== 'done') ||
    !isFiniteNumber(item.durationMs) ||
    !isFiniteNumber(item.startedAt) ||
    !isFiniteNumber(item.endsAt)
  ) {
    return null;
  }
  const stored: StoredTimer = {
    id: item.id,
    type: item.type,
    label: item.label,
    durationMs: item.durationMs,
    startedAt: item.startedAt,
    endsAt: item.endsAt,
    state: item.state,
  };
  if (isFiniteNumber(item.firedAt)) stored.firedAt = item.firedAt;
  return stored;
}

/** Validator for JsonStore: keeps readable records, drops damaged ones, rejects foreign files. */
export function parseTimersFile(raw: unknown): TimersFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('Timers file is not an object');
  const file = raw as { version?: unknown; records?: unknown };
  if (file.version !== 1 || !Array.isArray(file.records)) {
    throw new Error('Unsupported timers file');
  }
  const records: StoredTimer[] = [];
  for (const entry of file.records as unknown[]) {
    const record = toStoredTimer(entry);
    if (record !== null) records.push(record);
  }
  return { version: 1, records };
}

/** Opens (or creates) the persistent timers document at `filePath`. */
export function openTimersStore(filePath: string, logger?: Logger): JsonStore<TimersFile> {
  return new JsonStore<TimersFile>({
    filePath,
    defaults: emptyTimersFile,
    parse: parseTimersFile,
    logger,
  });
}

export interface TimersServiceOptions {
  store: JsonStore<TimersFile>;
  now?: () => number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
  newId?: () => string;
  logger?: Logger;
}

export type TimerFireListener = (record: TimerRecord, info: { missed: boolean }) => void;

function snapshot(record: StoredTimer): TimerRecord {
  return {
    id: record.id,
    type: record.type,
    label: record.label,
    durationMs: record.durationMs,
    startedAt: record.startedAt,
    endsAt: record.endsAt,
    state: record.state,
  };
}

function byDueTime(a: TimerRecord, b: TimerRecord): number {
  return a.endsAt - b.endsAt || a.startedAt - b.startedAt;
}

/**
 * Timers, alarms and reminders that survive restarts. Records live in a JsonStore; every
 * running record has a JS timer that is re-armed by `start()` (also after resume from sleep).
 */
export class TimersServiceImpl implements TimersService {
  private readonly store: JsonStore<TimersFile>;
  private readonly now: () => number;
  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;
  private readonly newId: () => string;
  private readonly logger: Logger;
  private readonly handles = new Map<string, unknown>();
  private readonly fireListeners = new Set<TimerFireListener>();
  private readonly changeListeners = new Set<() => void>();
  private disposed = false;

  constructor(options: TimersServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? defaultSetTimer;
    this.clearTimer = options.clearTimer ?? defaultClearTimer;
    this.newId = options.newId ?? randomUUID;
    this.logger = options.logger ?? silentLogger;
  }

  startTimer(options: { durationMs: number; label?: string }): TimerRecord {
    const { durationMs } = options;
    if (!isFiniteNumber(durationMs) || durationMs <= 0) {
      throw new RangeError('A timer needs a positive duration');
    }
    const startedAt = this.now();
    return this.add('timer', options.label, startedAt, startedAt + durationMs);
  }

  schedule(options: { at: number; label: string; type: 'reminder' | 'alarm' }): TimerRecord {
    if (!isFiniteNumber(options.at)) throw new RangeError('A scheduled time must be a timestamp');
    return this.add(options.type, options.label, this.now(), options.at);
  }

  list(): TimerRecord[] {
    this.prune();
    return this.running().map(snapshot).sort(byDueTime);
  }

  /** Any record still on disk, including finished ones (kept for an hour). */
  get(id: string): TimerRecord | null {
    this.prune();
    const record = this.find(id);
    return record === undefined ? null : snapshot(record);
  }

  cancel(id: string): boolean {
    const record = this.find(id);
    if (record === undefined || record.state !== 'running') return false;
    this.disarm(id);
    this.store.update((file) => ({
      ...file,
      records: file.records.filter((entry) => entry.id !== id),
    }));
    this.emitChange();
    return true;
  }

  cancelAll(): number {
    const running = this.running();
    if (running.length === 0) return 0;
    const ids = new Set(running.map((record) => record.id));
    for (const id of ids) this.disarm(id);
    this.store.update((file) => ({
      ...file,
      records: file.records.filter((entry) => !ids.has(entry.id)),
    }));
    this.emitChange();
    return ids.size;
  }

  onFire(listener: TimerFireListener): () => void {
    this.fireListeners.add(listener);
    return () => {
      this.fireListeners.delete(listener);
    };
  }

  /** Called after every change to the set of records (UI refresh). */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * Arms every persisted running record. Records that are already due fire once with
   * `missed: true`. Safe to call again (e.g. after resume from sleep): old timers are cleared.
   */
  start(): void {
    if (this.disposed) return;
    this.clearHandles();
    this.prune();
    const stamp = this.now();
    const running = this.running().map(snapshot).sort(byDueTime);
    for (const record of running) {
      if (record.endsAt > stamp) this.arm(record.id, record.endsAt);
    }
    for (const record of running) {
      if (record.endsAt <= stamp) this.fire(record.id, true);
    }
  }

  /** Stops all JS timers and listeners and writes pending changes. Records stay on disk. */
  dispose(): void {
    this.disposed = true;
    this.clearHandles();
    this.fireListeners.clear();
    this.changeListeners.clear();
    this.store.flushSync();
  }

  private add(
    type: TimerRecord['type'],
    label: string | undefined,
    startedAt: number,
    endsAt: number,
  ): TimerRecord {
    const text = (label ?? '').trim().slice(0, MAX_LABEL_LENGTH);
    const record: StoredTimer = {
      id: this.newId(),
      type,
      label: text === '' ? DEFAULT_LABELS[type] : text,
      durationMs: Math.max(0, endsAt - startedAt),
      startedAt,
      endsAt,
      state: 'running',
    };
    this.store.update((file) => {
      file.records.push(record);
    });
    this.arm(record.id, record.endsAt);
    this.emitChange();
    return snapshot(record);
  }

  private find(id: string): StoredTimer | undefined {
    return this.store.get().records.find((record) => record.id === id);
  }

  private running(): StoredTimer[] {
    return this.store.get().records.filter((record) => record.state === 'running');
  }

  private arm(id: string, endsAt: number): void {
    if (this.disposed) return;
    this.disarm(id);
    const delay = Math.min(Math.max(endsAt - this.now(), 0), MAX_TIMEOUT_MS);
    this.handles.set(
      id,
      this.setTimer(() => {
        this.onTimeout(id);
      }, delay),
    );
  }

  private disarm(id: string): void {
    if (!this.handles.has(id)) return;
    this.clearTimer(this.handles.get(id));
    this.handles.delete(id);
  }

  private clearHandles(): void {
    for (const id of [...this.handles.keys()]) this.disarm(id);
  }

  /** Runs when a JS timer elapsed: fires the record, or re-arms for the rest of a long delay. */
  private onTimeout(id: string): void {
    this.handles.delete(id);
    const record = this.find(id);
    if (record === undefined || record.state !== 'running') return;
    if (record.endsAt - this.now() > 0) this.arm(id, record.endsAt);
    else this.fire(id, false);
  }

  private fire(id: string, missed: boolean): void {
    const record = this.find(id);
    if (record === undefined || record.state !== 'running') return;
    this.disarm(id);
    const firedAt = this.now();
    this.store.update(() => {
      record.state = 'done';
      record.firedAt = firedAt;
    });
    for (const listener of [...this.fireListeners]) {
      try {
        listener(snapshot(record), { missed });
      } catch (error) {
        this.logger.error('Timer listener failed', error);
      }
    }
    this.emitChange();
  }

  private prune(): void {
    const cutoff = this.now() - DONE_RETENTION_MS;
    const expired = (record: StoredTimer): boolean =>
      record.state === 'done' && (record.firedAt ?? record.endsAt) < cutoff;
    if (!this.store.get().records.some(expired)) return;
    this.store.update((file) => ({
      ...file,
      records: file.records.filter((record) => !expired(record)),
    }));
  }

  private emitChange(): void {
    for (const listener of [...this.changeListeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.error('Timer change listener failed', error);
      }
    }
  }
}

export function createTimersService(options: TimersServiceOptions): TimersServiceImpl {
  return new TimersServiceImpl(options);
}

import type { VoiceModelState } from '@shared/ipc/types';

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_KB = 1024;
const SLOW_BYTES_PER_SECOND = 100 * BYTES_PER_KB;
const MILESTONES = [75, 50, 25] as const;
const CANCELLED = /cancel/i;

/** 41184862 -> "39.3 MB" (the unit Windows shows in file properties). */
export function formatMegabytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  return `${(safe / BYTES_PER_MB).toFixed(1)} MB`;
}

/** Null while the rate is unknown; slow links read better in KB/s. */
export function formatSpeed(bytesPerSecond: number): string | null {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  if (bytesPerSecond < SLOW_BYTES_PER_SECOND) {
    return `${Math.max(1, Math.round(bytesPerSecond / BYTES_PER_KB))} KB/s`;
  }
  return `${(bytesPerSecond / BYTES_PER_MB).toFixed(1)} MB/s`;
}

/** 75 -> "1 min 15 s", 640 -> "11 min" (rounded up). Null while there is no estimate. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.ceil(seconds);
  if (total < 60) return `${Math.max(1, total)} s`;
  if (total < 600) {
    const rest = total % 60;
    const minutes = Math.floor(total / 60);
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }
  const minutes = Math.ceil(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} hr` : `${hours} hr ${restMinutes} min`;
}

/** Whole percent, clamped to 0..100 (never rounds up to 100 before the last byte arrived). */
export function percentOf(received: number, total: number): number {
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((received / total) * 100)));
}

/**
 * Main reports a user-initiated pause as an `error` progress event ("The download was cancelled")
 * and keeps replaying it from `voice:modelStatus`. For the UI that is simply a paused download:
 * the partial file is kept and resuming continues where it stopped.
 */
export function settleModelState(state: VoiceModelState, userPaused: boolean): VoiceModelState {
  if (state.state !== 'error') return state;
  if (!userPaused && !CANCELLED.test(state.message ?? '')) return state;
  const { message: _message, ...rest } = state;
  return { ...rest, state: state.receivedBytes > 0 ? 'partial' : 'missing' };
}

export type ModelPhase = 'missing' | 'partial' | 'downloading' | 'verifying' | 'ready' | 'error';

/** Display strings for one `VoiceModelState` (all numbers come from the real state). */
export interface ModelView {
  phase: ModelPhase;
  percent: number;
  /** "12.3 MB" */
  received: string;
  total: string;
  /** Null until a transfer rate is known. */
  speed: string | null;
  eta: string | null;
  /** "2 of 4" while downloading with retries configured. */
  attempt: string | null;
  message: string | null;
  name: string;
}

export function describeModel(state: VoiceModelState): ModelView {
  const complete = state.totalBytes > 0 && state.receivedBytes >= state.totalBytes;
  const verifying = state.state === 'downloading' && complete;
  const transferring = state.state === 'downloading' && !verifying;
  const ready = state.state === 'ready';
  return {
    phase: verifying ? 'verifying' : state.state,
    percent: ready ? 100 : percentOf(state.receivedBytes, state.totalBytes),
    received: formatMegabytes(ready ? state.totalBytes : state.receivedBytes),
    total: formatMegabytes(state.totalBytes),
    speed: transferring ? formatSpeed(state.bytesPerSecond) : null,
    eta: transferring ? formatEta(state.etaSeconds) : null,
    attempt:
      state.state === 'downloading' && state.maxAttempts > 1
        ? `${state.attempt} of ${state.maxAttempts}`
        : null,
    message: ready ? null : (state.message ?? null),
    name: state.displayName,
  };
}

/**
 * What to say through the live region when the model changes: state transitions and the 25 / 50 /
 * 75 % milestones (the highest one crossed, never every progress tick). The very first snapshot is
 * not announced.
 */
export function modelAnnouncement(
  previous: VoiceModelState | null,
  next: VoiceModelState,
): string | null {
  if (!previous) return null;
  if (previous.state !== next.state) {
    switch (next.state) {
      case 'downloading':
        return 'Downloading the voice model.';
      case 'ready':
        return 'Voice model ready.';
      case 'partial':
        return 'Voice model download paused.';
      case 'error':
        return next.message
          ? `Voice model download failed. ${next.message}`
          : 'Voice model download failed.';
      case 'missing':
        return null;
    }
  }
  if (next.state !== 'downloading') return null;
  const before = percentOf(previous.receivedBytes, previous.totalBytes);
  const after = percentOf(next.receivedBytes, next.totalBytes);
  const milestone = MILESTONES.find((value) => before < value && after >= value);
  return milestone === undefined ? null : `Voice model ${milestone} percent downloaded.`;
}

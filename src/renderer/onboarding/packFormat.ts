import type { SpeechPackState, SpeechState } from '@shared/ipc/types';
import { SPEECH_PACKS, type SpeechPackId } from '@shared/speech/packs';
import {
  formatEta,
  formatMegabytes,
  formatSpeed,
  percentOf,
  type ModelPhase,
  type ModelView,
} from './modelFormat';

/** What "Best" downloads: accurate recognition (Whisper small) and the natural voice. */
export const BEST_PACKS = [
  'whisper-small',
  'supertonic-3',
] as const satisfies readonly SpeechPackId[];

const PACK_NAMES: Record<SpeechPackId, string> = {
  'whisper-small': 'Accurate recognition',
  'whisper-base': 'Fast recognition',
  'supertonic-3': 'Natural voice',
};

const CANCELLED = /cancel/i;
const MILESTONES = [75, 50, 25] as const;

export interface PackLine {
  id: SpeechPackId;
  name: string;
  /** "358 MB" */
  size: string;
  phase: ModelPhase;
  percent: number;
}

/** The combined progress of several packs, shaped like one voice-model download. */
export interface PackProgress extends ModelView {
  lines: PackLine[];
}

export interface CombineOptions {
  /** The user pressed Pause: a cancelled pack is a pause, not a failure. */
  paused?: boolean;
  /** A download was started and not stopped: a pack that has not begun yet is still on its way. */
  started?: boolean;
}

/** A cancelled download is reported as an error; for the UI it is simply a pause. */
function settle(pack: SpeechPackState, paused: boolean): SpeechPackState {
  if (pack.state !== 'error') return pack;
  if (!paused && !CANCELLED.test(pack.message ?? '')) return pack;
  const { message: _message, ...rest } = pack;
  return { ...rest, state: 'missing' };
}

function sizeOf(pack: SpeechPackState): number {
  return pack.totalBytes > 0 ? pack.totalBytes : SPEECH_PACKS[pack.id].sizeBytes;
}

function receivedOf(pack: SpeechPackState): number {
  return pack.state === 'ready' ? sizeOf(pack) : Math.min(pack.receivedBytes, sizeOf(pack));
}

function linePhase(pack: SpeechPackState): ModelPhase {
  switch (pack.state) {
    case 'verifying':
    case 'extracting':
      return 'verifying';
    case 'missing':
      return pack.receivedBytes > 0 ? 'partial' : 'missing';
    default:
      return pack.state;
  }
}

function phaseOf(
  packs: readonly SpeechPackState[],
  received: number,
  started: boolean,
): ModelPhase {
  if (packs.some((pack) => pack.state === 'error')) return 'error';
  if (packs.some((pack) => pack.state === 'downloading')) return 'downloading';
  if (packs.some((pack) => pack.state === 'verifying' || pack.state === 'extracting')) {
    return 'verifying';
  }
  if (packs.every((pack) => pack.state === 'ready')) return 'ready';
  if (started) return 'downloading';
  return received > 0 ? 'partial' : 'missing';
}

/**
 * One combined view of the packs a choice needs: percent over all bytes, the summed speed and the
 * time left for what remains. Null until the pack status has been read.
 */
export function combinePacks(
  state: SpeechState | null,
  ids: readonly SpeechPackId[],
  { paused = false, started = false }: CombineOptions = {},
): PackProgress | null {
  if (!state) return null;
  const packs = ids.map((id) => settle(state.packs[id], paused));

  let received = 0;
  let total = 0;
  let speed = 0;
  for (const pack of packs) {
    received += receivedOf(pack);
    total += sizeOf(pack);
    if (pack.state === 'downloading') speed += Math.max(0, pack.bytesPerSecond);
  }

  const phase = phaseOf(packs, received, started && !paused);
  const transferring = phase === 'downloading';
  const failed = packs.find((pack) => pack.state === 'error');
  const working = packs.find((pack) => pack.message && pack.state !== 'ready');
  return {
    phase,
    percent: phase === 'ready' ? 100 : percentOf(received, total),
    received: formatMegabytes(phase === 'ready' ? total : received),
    total: formatMegabytes(total),
    speed: transferring ? formatSpeed(speed) : null,
    eta: transferring && speed > 0 ? formatEta((total - received) / speed) : null,
    attempt: null,
    message: phase === 'ready' ? null : (failed?.message ?? working?.message ?? null),
    name: ids.map((id) => PACK_NAMES[id]).join(' + '),
    lines: packs.map((pack) => ({
      id: pack.id,
      name: PACK_NAMES[pack.id],
      size: formatMegabytes(sizeOf(pack)),
      phase: linePhase(pack),
      percent: pack.state === 'ready' ? 100 : percentOf(receivedOf(pack), sizeOf(pack)),
    })),
  };
}

/** The packs that are neither ready nor already moving: what "Download" still has to start. */
export function packsToStart(
  state: SpeechState | null,
  ids: readonly SpeechPackId[],
): SpeechPackId[] {
  return ids.filter((id) => {
    const current = state?.packs[id].state;
    return current !== 'ready' && current !== 'downloading';
  });
}

/** The packs that can be paused right now. */
export function packsInMotion(
  state: SpeechState | null,
  ids: readonly SpeechPackId[],
): SpeechPackId[] {
  return ids.filter((id) => {
    const current = state?.packs[id].state;
    return current === 'downloading' || current === 'verifying' || current === 'extracting';
  });
}

/**
 * What to say through the live region when the combined download changes: state changes and the
 * 25 / 50 / 75 % milestones (the highest one crossed). The first snapshot is not announced.
 */
export function packAnnouncement(
  previous: PackProgress | null,
  next: PackProgress,
  subject: string,
): string | null {
  if (!previous) return null;
  if (previous.phase !== next.phase) {
    switch (next.phase) {
      case 'downloading':
        return `Downloading ${subject}.`;
      case 'ready':
        return `${subject} ready.`;
      case 'partial':
        return `${subject} download paused.`;
      case 'error':
        return next.message
          ? `${subject} download failed. ${next.message}`
          : `${subject} download failed.`;
      case 'verifying':
      case 'missing':
        return null;
    }
  }
  if (next.phase !== 'downloading') return null;
  const milestone = MILESTONES.find((value) => previous.percent < value && next.percent >= value);
  return milestone === undefined ? null : `${subject} ${milestone} percent downloaded.`;
}

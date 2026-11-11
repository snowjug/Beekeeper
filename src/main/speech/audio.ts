/** Pure audio helpers for the speech engine (no native dependencies, fully unit-tested). */

export const WHISPER_SAMPLE_RATE = 16_000;
/** Whisper decodes at most 30 s per window; longer recordings are cut at quiet points. */
const MAX_CHUNK_SECONDS = 28;
const SEARCH_WINDOW_SECONDS = 6;
const FRAME_SECONDS = 0.1;

function meanAbs(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += Math.abs(samples[index] ?? 0);
  return to > from ? sum / (to - from) : 0;
}

/**
 * Splits a long recording into chunks of at most 28 s, cutting where the audio is quietest
 * (between words) instead of in the middle of a word.
 */
export function splitForWhisper(
  samples: Float32Array,
  sampleRate = WHISPER_SAMPLE_RATE,
): Float32Array[] {
  const max = Math.round(MAX_CHUNK_SECONDS * sampleRate);
  if (samples.length <= max) return [samples];

  const frame = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  const window = Math.round(SEARCH_WINDOW_SECONDS * sampleRate);
  const chunks: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > max) {
    const limit = start + max;
    let bestCut = limit;
    let bestLevel = Number.POSITIVE_INFINITY;
    for (let from = limit - window; from + frame <= limit; from += frame) {
      const level = meanAbs(samples, from, from + frame);
      if (level < bestLevel) {
        bestLevel = level;
        bestCut = from + Math.round(frame / 2);
      }
    }
    chunks.push(samples.subarray(start, bestCut));
    start = bestCut;
  }
  chunks.push(samples.subarray(start));
  return chunks;
}

export interface TrimOptions {
  /** Amplitude (0..1) below which a 10 ms window counts as silence. */
  threshold?: number;
  keepStartMs?: number;
  keepEndMs?: number;
}

/**
 * Removes the silence the voice model leaves before and after a sentence, so replies start and
 * end promptly. A short margin is kept so consonants are not clipped.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  options: TrimOptions = {},
): Float32Array {
  const threshold = options.threshold ?? 0.004;
  const keepStart = Math.round(((options.keepStartMs ?? 40) / 1000) * sampleRate);
  const keepEnd = Math.round(((options.keepEndMs ?? 160) / 1000) * sampleRate);
  const window = Math.max(1, Math.round(sampleRate / 100));

  let first = -1;
  let last = -1;
  for (let from = 0; from < samples.length; from += window) {
    if (meanAbs(samples, from, Math.min(samples.length, from + window)) > threshold) {
      if (first < 0) first = from;
      last = Math.min(samples.length, from + window);
    }
  }
  if (first < 0) return samples.subarray(0, Math.min(samples.length, keepStart + keepEnd));
  const begin = Math.max(0, first - keepStart);
  const end = Math.min(samples.length, last + keepEnd);
  return samples.subarray(begin, end);
}

export function pcmDurationMs(sampleCount: number, sampleRate: number): number {
  return Math.round((sampleCount / sampleRate) * 1000);
}

/** Copies the samples into a standalone ArrayBuffer (safe to transfer or send over IPC). */
export function toArrayBuffer(samples: Float32Array): ArrayBuffer {
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return copy.buffer;
}

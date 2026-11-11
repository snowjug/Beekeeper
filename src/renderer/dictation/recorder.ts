/**
 * The recording behind the dictation pill: collects the microphone chunks, lets the voice
 * activity detector decide when the speaker is done, and hands over 16 kHz audio without the
 * long silences around the speech. Pure logic (no browser APIs), so it is unit tested.
 */
import {
  concatChunks,
  normalizeLevel,
  resampleTo16k,
  WHISPER_RATE,
} from '@renderer/lib/voice/audio';
import { EndpointDetector, type EndpointEvent } from '@renderer/lib/voice/vad';

/** Audio kept before the first word, so a soft first syllable is not clipped. */
export const PRE_ROLL_MS = 300;
/** Audio kept after the last word. */
export const TAIL_MS = 300;
/** Give up when nothing is said for this long. */
export const NO_SPEECH_MS = 10_000;
/** The main process refuses recordings shorter than 100 ms. */
export const MIN_SUBMIT_SAMPLES = 1600;
/** ...and longer than 60 s. */
export const MAX_SUBMIT_SAMPLES = 60 * WHISPER_RATE;

const MIN_SPEECH_MS = 150;
/** Chunks quieter than this are never speech; ones louder than the cap always are. */
const MIN_VOICED_LEVEL = 0.012;
const MAX_VOICED_LEVEL = 0.05;
/** Speech is this many times louder than the quietest moment of the recording. */
const FLOOR_MARGIN = 3.2;

/** Root mean square of a chunk, 0..1. */
export function chunkRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/**
 * The level above which a chunk counts as speech, judged against the quietest chunk of the whole
 * recording (so a long speech without pauses is not mistaken for background noise).
 */
export function voicedThreshold(levels: readonly number[]): number {
  const quietest = levels.reduce(
    (lowest, level) => Math.min(lowest, level),
    Number.POSITIVE_INFINITY,
  );
  const scaled = Number.isFinite(quietest) ? quietest * FLOOR_MARGIN : 0;
  return Math.min(MAX_VOICED_LEVEL, Math.max(MIN_VOICED_LEVEL, scaled));
}

export interface TrimInput {
  /** Length of every recorded chunk, in samples. */
  chunkLengths: readonly number[];
  /** Index of the first and the last chunk that holds speech. */
  firstVoiced: number;
  lastVoiced: number;
  sampleRate: number;
  preRollMs?: number;
  tailMs?: number;
}

/** The sample range to keep: the speech plus a little context on both sides. */
export function trimRange(input: TrimInput): { start: number; end: number } {
  const { chunkLengths, firstVoiced, lastVoiced, sampleRate } = input;
  const preRoll = Math.round(((input.preRollMs ?? PRE_ROLL_MS) / 1000) * sampleRate);
  const tail = Math.round(((input.tailMs ?? TAIL_MS) / 1000) * sampleRate);

  let total = 0;
  let speechStart = 0;
  let speechEnd = 0;
  chunkLengths.forEach((length, index) => {
    if (index === firstVoiced) speechStart = total;
    total += length;
    if (index === lastVoiced) speechEnd = total;
  });
  return { start: Math.max(0, speechStart - preRoll), end: Math.min(total, speechEnd + tail) };
}

export interface RecordingOptions {
  /** Silence after speech that ends the recording. */
  silenceMs: number;
  /** Hard limit of one recording. */
  maxSeconds: number;
  /** Audio to ignore at the start (the start beep leaks into the microphone). */
  discardMs?: number;
  noSpeechMs?: number;
}

/** One dictation's audio. Feed it the worklet chunks; it says when the speaker has finished. */
export class Recording {
  private readonly detector: EndpointDetector;
  private readonly chunks: Float32Array[] = [];
  private readonly levels: number[] = [];
  private readonly discardMs: number;
  private rate = WHISPER_RATE;
  private skippedMs = 0;
  private sealed = false;

  constructor(options: RecordingOptions) {
    this.discardMs = options.discardMs ?? 0;
    this.detector = new EndpointDetector({
      silenceMs: options.silenceMs,
      maxUtteranceMs: options.maxSeconds * 1000,
      noSpeechMs: options.noSpeechMs ?? NO_SPEECH_MS,
      minSpeechMs: MIN_SPEECH_MS,
    });
  }

  /** True once the speaker has said something (not just made a noise). */
  get hasSpeech(): boolean {
    return this.detector.hasSpeech;
  }

  push(chunk: Float32Array, sampleRate: number): EndpointEvent {
    if (this.sealed) return 'none';
    this.rate = sampleRate;
    const chunkMs = (chunk.length / sampleRate) * 1000;
    if (this.skippedMs < this.discardMs) {
      this.skippedMs += chunkMs;
      return 'none';
    }

    const level = chunkRms(chunk);
    this.chunks.push(chunk.slice());
    this.levels.push(level);
    const event = this.detector.push(level, chunkMs);
    if (event === 'speech-end' || event === 'max-duration' || event === 'no-speech') {
      this.sealed = true;
    }
    return event;
  }

  /** The speech with a little context, at 16 kHz; null when nothing was said. */
  finish(): Float32Array<ArrayBuffer> | null {
    if (!this.detector.hasSpeech) return null;
    const threshold = voicedThreshold(this.levels);
    const firstVoiced = this.levels.findIndex((level) => level > threshold);
    if (firstVoiced < 0) return null;
    const lastVoiced = this.levels.findLastIndex((level) => level > threshold);

    const { start, end } = trimRange({
      chunkLengths: this.chunks.map((chunk) => chunk.length),
      firstVoiced,
      lastVoiced,
      sampleRate: this.rate,
    });
    const kept = concatChunks(this.chunks).subarray(start, end);
    // A quiet microphone is lifted to a level Whisper likes; the copy keeps the IPC payload tight.
    const audio = normalizeLevel(resampleTo16k(kept, this.rate))
      .subarray(0, MAX_SUBMIT_SAMPLES)
      .slice();
    return audio.length >= MIN_SUBMIT_SAMPLES ? audio : null;
  }
}

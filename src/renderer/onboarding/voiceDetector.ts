import { clamp } from '@renderer/motion/math';

/** Everything that tunes the "I can hear you" check of the microphone test. */
export interface VoiceDetectorOptions {
  /** RMS level (0..1) that counts as sound. Normal speech sits around 0.02-0.2. */
  threshold: number;
  /** How long the level has to stay above the threshold. */
  holdMs: number;
  /** Dips shorter than this (between words) do not restart the hold timer. */
  graceMs: number;
}

export const MIC_TEST_OPTIONS: VoiceDetectorOptions = {
  threshold: 0.02,
  holdMs: 400,
  graceMs: 160,
};

/** The test gives up after this long without hearing anything. */
export const MIC_TEST_TIMEOUT_MS = 8000;
/** After success the microphone stays open briefly so the meter can finish its flourish. */
export const MIC_SUCCESS_RELEASE_MS = 1000;

/** Linear gain between RMS and the 0..1 meter (same scale the assistant bar uses). */
const METER_GAIN = 6;

/** Maps a raw RMS value to the 0..1 position on the level meter. */
export function toMeterLevel(rms: number): number {
  return Number.isFinite(rms) ? clamp(rms * METER_GAIN, 0, 1) : 0;
}

/**
 * Decides that the microphone "hears" the user: the level must stay above the threshold for
 * `holdMs`, tolerating brief dips so natural speech (words, pauses) is not penalised.
 */
export class VoiceDetector {
  private aboveMs = 0;
  private gapMs = 0;
  private done = false;

  constructor(private readonly options: VoiceDetectorOptions = MIC_TEST_OPTIONS) {}

  get detected(): boolean {
    return this.done;
  }

  /** Feeds one level sample; returns true from the moment sound was detected onwards. */
  push(rms: number, dtMs: number): boolean {
    if (this.done) return true;
    const elapsed = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;
    if (Number.isFinite(rms) && rms >= this.options.threshold) {
      this.aboveMs += elapsed;
      this.gapMs = 0;
      if (this.aboveMs >= this.options.holdMs) this.done = true;
    } else {
      this.gapMs += elapsed;
      if (this.gapMs > this.options.graceMs) this.aboveMs = 0;
    }
    return this.done;
  }
}

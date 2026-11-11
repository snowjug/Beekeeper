/** Facts about a recording that help to tell speech from the noise Whisper likes to "transcribe". */

export const DICTATION_SAMPLE_RATE = 16_000;

const FRAME_MS = 20;
/** Frames quieter than this never count as voiced (matches the recorder's detector). */
const MIN_VOICED_RMS = 0.012;
/** How far above the background (the quietest tenth of the frames) speech has to rise. */
const FLOOR_MARGIN = 3.2;

export interface AudioFacts {
  durationMs: number;
  /** Milliseconds of audio that is clearly louder than the background. */
  voicedMs: number;
  /** RMS of the loudest 20 ms frame (0..1). */
  peakRms: number;
}

function frameRms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/** Measures a mono recording: its length, its loudest moment and how much of it is speech-like. */
export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number = DICTATION_SAMPLE_RATE,
): AudioFacts {
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  if (samples.length === 0) return { durationMs, voicedMs: 0, peakRms: 0 };

  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const levels: number[] = [];
  for (let from = 0; from < samples.length; from += frameSize) {
    levels.push(frameRms(samples, from, Math.min(samples.length, from + frameSize)));
  }

  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const threshold = Math.max(MIN_VOICED_RMS, floor * FLOOR_MARGIN);
  const voiced = levels.filter((level) => level > threshold).length;

  return {
    durationMs,
    voicedMs: voiced * FRAME_MS,
    peakRms: sorted[sorted.length - 1] ?? 0,
  };
}

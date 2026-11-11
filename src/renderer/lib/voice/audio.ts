/** Small audio helpers for the recognition pipeline (pure, unit-tested). */

export const WHISPER_RATE = 16_000;

type PcmArray = Float32Array<ArrayBuffer>;

export function concatChunks(chunks: readonly Float32Array[]): PcmArray {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Linear resampling to 16 kHz (the rate Whisper expects); returns the input when it already is. */
export function resampleTo16k(samples: PcmArray, fromRate: number): PcmArray {
  if (fromRate === WHISPER_RATE || samples.length === 0) return samples;
  const ratio = fromRate / WHISPER_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const base = Math.floor(position);
    const fraction = position - base;
    const current = samples[base] ?? 0;
    const next = samples[base + 1] ?? current;
    out[index] = current + (next - current) * fraction;
  }
  return out;
}

/** Highest absolute sample value of a recording (0..1). */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/**
 * Lifts quiet recordings (a distant microphone) to a comfortable level without clipping; Whisper
 * is noticeably less accurate on very quiet audio. Loud recordings are left alone.
 */
export function normalizeLevel(samples: PcmArray, target = 0.6, maxGain = 8): PcmArray {
  const peak = peakOf(samples);
  if (peak < 0.005 || peak >= target * 0.6) return samples;
  const gain = Math.min(maxGain, target / peak);
  const out = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    out[index] = (samples[index] ?? 0) * gain;
  }
  return out;
}

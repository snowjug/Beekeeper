import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '@main/dictation/audio';

const RATE = 16_000;

/** `seconds` of a sine wave at the given amplitude (RMS = amplitude / sqrt 2). */
function tone(seconds: number, amplitude: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / RATE);
  }
  return samples;
}

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('analyzeAudio', () => {
  it('reports nothing for an empty recording', () => {
    expect(analyzeAudio(new Float32Array(0))).toEqual({ durationMs: 0, voicedMs: 0, peakRms: 0 });
  });

  it('treats digital silence as no speech', () => {
    expect(analyzeAudio(new Float32Array(RATE))).toEqual({
      durationMs: 1000,
      voicedMs: 0,
      peakRms: 0,
    });
  });

  it('counts only the loud part of a recording as voiced', () => {
    const quiet = tone(1, 0.002);
    const speech = tone(1.2, 0.3);
    const facts = analyzeAudio(join(quiet, speech, quiet));
    expect(facts.durationMs).toBe(3200);
    expect(facts.voicedMs).toBe(1200);
    expect(facts.peakRms).toBeCloseTo(0.3 / Math.SQRT2, 2);
  });

  it('does not call steady background noise speech', () => {
    const facts = analyzeAudio(tone(2, 0.01));
    expect(facts.voicedMs).toBe(0);
    expect(facts.peakRms).toBeLessThan(0.01);
  });

  it('handles a recording shorter than one frame', () => {
    const facts = analyzeAudio(tone(0.01, 0.3));
    expect(facts.durationMs).toBe(10);
    expect(facts.peakRms).toBeGreaterThan(0.1);
  });

  it('measures other sample rates by their own length', () => {
    const samples = new Float32Array(8000);
    expect(analyzeAudio(samples, 8000).durationMs).toBe(1000);
  });
});

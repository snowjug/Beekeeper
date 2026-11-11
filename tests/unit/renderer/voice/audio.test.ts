import { describe, expect, it } from 'vitest';
import { concatChunks, normalizeLevel, peakOf, resampleTo16k } from '@renderer/lib/voice/audio';

describe('concatChunks', () => {
  it('joins chunks in order', () => {
    const joined = concatChunks([Float32Array.of(1, 2), Float32Array.of(), Float32Array.of(3)]);
    expect([...joined]).toEqual([1, 2, 3]);
  });
});

describe('resampleTo16k', () => {
  it('returns the input untouched at 16 kHz and for empty audio', () => {
    const samples = Float32Array.of(0.1, 0.2);
    expect(resampleTo16k(samples, 16_000)).toBe(samples);
    const empty = new Float32Array(0);
    expect(resampleTo16k(empty, 48_000)).toBe(empty);
  });

  it('downsamples 48 kHz to a third of the length', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = resampleTo16k(input, 48_000);
    expect(out.length).toBe(1600);
    expect(out.every((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true);
  });

  it('interpolates between samples when upsampling', () => {
    const out = resampleTo16k(Float32Array.of(0, 1, 0, 1), 8000);
    expect(out.length).toBe(8);
    expect(out[1]).toBeCloseTo(0.5);
  });
});

describe('normalizeLevel', () => {
  it('lifts a quiet recording towards the target without clipping', () => {
    const quiet = Float32Array.of(0.02, -0.04, 0.03);
    const out = normalizeLevel(quiet);
    expect(peakOf(out)).toBeCloseTo(0.32, 2); // gain is capped at 8x
    expect(peakOf(out)).toBeLessThan(1);
  });

  it('leaves normal and loud recordings alone', () => {
    const loud = Float32Array.of(0.5, -0.8);
    expect(normalizeLevel(loud)).toBe(loud);
  });

  it('does not amplify near-silence into noise', () => {
    const silence = Float32Array.of(0.001, -0.002);
    expect(normalizeLevel(silence)).toBe(silence);
  });
});

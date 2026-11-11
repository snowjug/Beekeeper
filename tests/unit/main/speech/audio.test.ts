import { describe, expect, it } from 'vitest';
import { pcmDurationMs, splitForWhisper, toArrayBuffer, trimSilence } from '@main/speech/audio';

const RATE = 16_000;

function tone(seconds: number, amplitude = 0.3): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / RATE);
  }
  return samples;
}

describe('splitForWhisper', () => {
  it('keeps a recording that fits in one window', () => {
    const samples = tone(10);
    const chunks = splitForWhisper(samples);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(samples);
  });

  it('cuts a long recording at its quietest point and loses no audio', () => {
    const samples = tone(60);
    // A pause between 25.0 s and 25.4 s is the natural place to cut.
    samples.fill(0, 25 * RATE, Math.round(25.4 * RATE));
    const chunks = splitForWhisper(samples);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(28 * RATE);
    expect(chunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(samples.length);
    const firstCut = chunks[0]?.length ?? 0;
    expect(firstCut).toBeGreaterThan(25 * RATE);
    expect(firstCut).toBeLessThan(25.4 * RATE);
  });

  it('still splits audio without any pause', () => {
    const chunks = splitForWhisper(tone(70));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(28 * RATE);
  });
});

describe('trimSilence', () => {
  it('removes the silence around speech but keeps a short margin', () => {
    const samples = new Float32Array(RATE * 3);
    samples.set(tone(1), RATE); // speech from 1.0 s to 2.0 s
    const trimmed = trimSilence(samples, RATE);
    expect(trimmed.length).toBeLessThan(samples.length);
    expect(trimmed.length).toBeGreaterThan(RATE); // speech + margins
    expect(trimmed.length).toBeLessThan(1.3 * RATE);
  });

  it('keeps only a stub of audio that is entirely silent', () => {
    const trimmed = trimSilence(new Float32Array(RATE * 2), RATE);
    expect(trimmed.length).toBeLessThan(0.3 * RATE);
  });

  it('does not touch audio that has no silence', () => {
    const samples = tone(1);
    expect(trimSilence(samples, RATE).length).toBe(samples.length);
  });
});

describe('small helpers', () => {
  it('computes durations in milliseconds', () => {
    expect(pcmDurationMs(RATE * 2.5, RATE)).toBe(2500);
  });

  it('copies samples into a standalone buffer', () => {
    const source = tone(1).subarray(100, 200);
    const buffer = toArrayBuffer(source);
    expect(buffer.byteLength).toBe(100 * 4);
    expect(new Float32Array(buffer)[0]).toBe(source[0]);
  });
});

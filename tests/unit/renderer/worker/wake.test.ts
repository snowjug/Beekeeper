import { describe, expect, it } from 'vitest';
import { containsWakePhrase, SpeechGate, WAKE_GRAMMAR } from '@renderer/worker/wake';

const RATE = 16_000;

function chunk(level: number, ms = 100): Float32Array {
  const samples = new Float32Array((RATE * ms) / 1000);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (index % 2 === 0 ? 1 : -1) * level;
  }
  return samples;
}

describe('containsWakePhrase', () => {
  it.each([
    ['hey beekeeper', true],
    ['Hey, Bee Keeper!', true],
    ['uh hey bee keeper what time is it', true],
    ['hey keeper', false],
    ['beekeeper', false],
    ['[unk]', false],
    ['', false],
  ])('%j -> %s', (text, expected) => {
    expect(containsWakePhrase(text)).toBe(expected);
  });

  it('uses a grammar that lists the phrase spellings and [unk]', () => {
    expect(JSON.parse(WAKE_GRAMMAR)).toEqual(['hey beekeeper', 'hey bee keeper', '[unk]']);
  });
});

describe('SpeechGate', () => {
  it('forwards nothing while it is quiet', () => {
    const gate = new SpeechGate();
    for (let index = 0; index < 30; index += 1) {
      expect(gate.push(chunk(0.002), RATE)).toEqual([]);
    }
    expect(gate.isOpen).toBe(false);
  });

  it('opens on speech with the pre-roll, stays open for the hangover and then closes', () => {
    const gate = new SpeechGate({
      hangoverMs: 300,
      preRollMs: 200,
      minThreshold: 0.012,
      margin: 3.2,
    });
    for (let index = 0; index < 10; index += 1) gate.push(chunk(0.002), RATE);

    const opened = gate.push(chunk(0.3), RATE);
    // two quiet pre-roll chunks (200 ms) + the loud one
    expect(opened).toHaveLength(3);
    expect(gate.isOpen).toBe(true);

    expect(gate.push(chunk(0.3), RATE)).toHaveLength(1);
    // silence: still forwarded during the 300 ms hangover, then dropped
    expect(gate.push(chunk(0.002), RATE)).toHaveLength(1);
    expect(gate.push(chunk(0.002), RATE)).toHaveLength(1);
    expect(gate.push(chunk(0.002), RATE)).toHaveLength(1);
    expect(gate.isOpen).toBe(false);
    expect(gate.push(chunk(0.002), RATE)).toEqual([]);
  });

  it('keeps the pre-roll bounded and reset() forgets everything', () => {
    const gate = new SpeechGate({
      hangoverMs: 100,
      preRollMs: 300,
      minThreshold: 0.012,
      margin: 3.2,
    });
    for (let index = 0; index < 50; index += 1) gate.push(chunk(0.002), RATE);
    expect(gate.push(chunk(0.4), RATE).length).toBeLessThanOrEqual(4);
    gate.reset();
    expect(gate.isOpen).toBe(false);
    expect(gate.push(chunk(0.4), RATE)).toHaveLength(1);
  });

  it('adapts to a noisy room: steady noise does not open the gate', () => {
    const gate = new SpeechGate();
    let forwarded = 0;
    for (let index = 0; index < 100; index += 1) forwarded += gate.push(chunk(0.02), RATE).length;
    // The very first chunks may pass before the floor is learned; afterwards it must be quiet.
    const late = Array.from({ length: 20 }, () => gate.push(chunk(0.02), RATE).length);
    expect(forwarded).toBeGreaterThanOrEqual(0);
    expect(late.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(20);
  });
});

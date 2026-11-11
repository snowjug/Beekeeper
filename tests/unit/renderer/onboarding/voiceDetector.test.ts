import { describe, expect, it } from 'vitest';
import { MIC_TEST_OPTIONS, toMeterLevel, VoiceDetector } from '@renderer/onboarding/voiceDetector';

const FRAME_MS = 16;

/** Feeds `ms` of constant level in frames; returns the time at which sound was detected. */
function feed(detector: VoiceDetector, level: number, ms: number): number | null {
  for (let elapsed = FRAME_MS; elapsed <= ms; elapsed += FRAME_MS) {
    if (detector.push(level, FRAME_MS)) return elapsed;
  }
  return null;
}

describe('VoiceDetector', () => {
  it('never fires on silence or ambient noise below the threshold', () => {
    const detector = new VoiceDetector();
    expect(feed(detector, 0, 20_000)).toBeNull();
    expect(feed(detector, MIC_TEST_OPTIONS.threshold * 0.9, 20_000)).toBeNull();
    expect(detector.detected).toBe(false);
  });

  it('fires once the level has stayed above the threshold for about 400 ms', () => {
    const detector = new VoiceDetector();
    const at = feed(detector, 0.15, 2000);
    expect(at).not.toBeNull();
    expect(at).toBeGreaterThanOrEqual(MIC_TEST_OPTIONS.holdMs);
    expect(at).toBeLessThan(MIC_TEST_OPTIONS.holdMs + 2 * FRAME_MS);
    expect(detector.detected).toBe(true);
  });

  it('ignores short blips such as a click or a knock', () => {
    const detector = new VoiceDetector();
    for (let i = 0; i < 10; i += 1) {
      expect(feed(detector, 0.5, 120)).toBeNull();
      expect(feed(detector, 0, 400)).toBeNull();
    }
  });

  it('tolerates the tiny dips between words but not a long pause', () => {
    const withDip = new VoiceDetector();
    feed(withDip, 0.2, 240);
    feed(withDip, 0, 100);
    expect(feed(withDip, 0.2, 400)).not.toBeNull();

    const withPause = new VoiceDetector();
    feed(withPause, 0.2, 240);
    feed(withPause, 0, 500);
    expect(feed(withPause, 0.2, 300)).toBeNull();
  });

  it('stays detected and treats broken readings as silence', () => {
    const detector = new VoiceDetector();
    feed(detector, 0.3, 1000);
    expect(detector.push(0, FRAME_MS)).toBe(true);
    expect(detector.push(Number.NaN, FRAME_MS)).toBe(true);

    const fresh = new VoiceDetector();
    expect(feed(fresh, Number.NaN, 2000)).toBeNull();
    expect(fresh.push(0.5, Number.NaN)).toBe(false);
  });

  it('honours custom options', () => {
    const detector = new VoiceDetector({ threshold: 0.5, holdMs: 100, graceMs: 0 });
    expect(feed(detector, 0.4, 1000)).toBeNull();
    expect(feed(detector, 0.6, 1000)).toBeLessThanOrEqual(112);
  });
});

describe('toMeterLevel', () => {
  it.each([
    [0, 0],
    [0.05, 0.3],
    [0.5, 1],
    [3, 1],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('maps RMS %s to %s', (rms, expected) => {
    expect(toMeterLevel(rms)).toBeCloseTo(expected);
  });

  it('puts the detection threshold inside the visible range of the meter', () => {
    const tick = toMeterLevel(MIC_TEST_OPTIONS.threshold);
    expect(tick).toBeGreaterThan(0.05);
    expect(tick).toBeLessThan(0.5);
  });
});

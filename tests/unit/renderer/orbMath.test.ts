import { describe, expect, it } from 'vitest';
import { resolveSheetSnap } from '@renderer/components/Sheet';
import {
  computeOrbFrame,
  describeOrbState,
  ORB_STATES,
  PARTICLE_COUNT,
  type OrbState,
} from '@renderer/components/orbMath';
import { waveformTargets } from '@renderer/components/Waveform';

function frame(state: OrbState, overrides: Partial<Parameters<typeof computeOrbFrame>[0]> = {}) {
  return computeOrbFrame({ state, time: 1.3, stateAge: 0.2, level: 0, pulse: 0, ...overrides });
}

describe('computeOrbFrame', () => {
  it.each(ORB_STATES)('describes %s with four particles and colours', (state) => {
    const result = frame(state);
    expect(result.particles).toHaveLength(PARTICLE_COUNT);
    expect(result.colors).toHaveLength(PARTICLE_COUNT);
    for (const particle of result.particles) {
      expect(particle.width).toBeGreaterThan(0);
      expect(particle.height).toBeGreaterThan(0);
    }
  });

  it('idle breathes between 0.9x and 1.05x of the dot size, staggered per dot', () => {
    const sizes = Array.from({ length: 200 }, (_, i) =>
      frame('idle', { time: i / 20 }).particles.map((p) => p.width),
    ).flat();
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(15 * 0.9 - 1e-9);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(15 * 1.05 + 1e-9);
    const first = frame('idle', { time: 0.5 }).particles.map((p) => p.width);
    expect(new Set(first.map((w) => w.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('listening turns dots into bars that grow with the audio level', () => {
    const quiet = frame('listening', { level: 0 }).particles;
    const loud = frame('listening', { level: 1 }).particles;
    expect(loud.every((p, i) => p.height > (quiet[i]?.height ?? 0))).toBe(true);
    expect(loud.some((p) => p.height > 40)).toBe(true);
    expect(loud.every((p) => p.height <= 74.0001)).toBe(true);
    expect(quiet.every((p) => p.height < 30)).toBe(true);
  });

  it('thinking orbits around the centre and enables the gooey merge', () => {
    const result = frame('thinking');
    expect(result.goo).toBe(1);
    for (const particle of result.particles) {
      const distance = Math.hypot(particle.x - 50, particle.y - 50);
      expect(distance).toBeLessThanOrEqual(22.0001);
    }
  });

  it('speaking pulses larger with TTS boundary events', () => {
    const calm = frame('speaking', { pulse: 0 }).particles[0]?.width ?? 0;
    const pulsed = frame('speaking', { pulse: 1 }).particles[0]?.width ?? 0;
    expect(pulsed).toBeGreaterThan(calm + 5);
    expect(frame('speaking').goo).toBe(1);
  });

  it('error is coral and shakes only briefly', () => {
    const early = frame('error', { stateAge: 0.03 });
    const late = frame('error', { stateAge: 3 });
    expect(early.colors.every((c) => c === 'rgb(255 90 95)')).toBe(true);
    expect(early.goo).toBe(0);
    const rest = frame('idle').particles.map((p) => p.x);
    const shaken = early.particles.map((p, i) => Math.abs(p.x - (rest[i] ?? 0)));
    const settled = late.particles.map((p, i) => Math.abs(p.x - (rest[i] ?? 0)));
    expect(Math.max(...shaken)).toBeGreaterThan(0.5);
    expect(Math.max(...settled)).toBeLessThan(0.01);
  });

  it('labels every state for assistive tech', () => {
    for (const state of ORB_STATES) expect(describeOrbState(state)).toMatch(/^Beekeeper /);
  });
});

describe('waveformTargets', () => {
  it('is silent at level 0 and peaks in the middle when loud', () => {
    expect(waveformTargets(0, 1, 24).every((v) => v === 0)).toBe(true);
    const loud = waveformTargets(1, 0.4, 25);
    expect(loud).toHaveLength(25);
    expect(loud.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(loud[12] ?? 0).toBeGreaterThan(loud[0] ?? 1);
    expect(waveformTargets(1, 0, 1)).toHaveLength(1);
  });
});

describe('resolveSheetSnap', () => {
  it.each([
    [0, 0, 300, 'expanded'],
    [300, 0, 300, 'collapsed'],
    [100, 0, 300, 'expanded'],
    [320, 0, 300, 'collapsed'],
    [420, 0, 300, 'close'],
    [300, 900, 300, 'close'],
    [300, -900, 300, 'expanded'],
  ] as const)('offset %d velocity %d -> %s', (offset, velocity, collapsed, expected) => {
    expect(resolveSheetSnap(offset, velocity, collapsed)).toBe(expected);
  });
});

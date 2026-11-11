import { describe, expect, it } from 'vitest';
import {
  clamp,
  hexToRgb,
  lerp,
  mixRgb,
  rgbToCss,
  samplePalette,
  smoothTowards,
  Spring,
} from '@renderer/motion/math';

function simulate(spring: Spring, seconds: number): { peak: number; final: number } {
  let peak = spring.value;
  for (let t = 0; t < seconds; t += 1 / 60) {
    peak = Math.max(peak, spring.step(1 / 60));
  }
  return { peak, final: spring.value };
}

describe('Spring', () => {
  it('settles on its target', () => {
    const spring = new Spring(0, { stiffness: 220, damping: 26 });
    spring.target = 100;
    const { final } = simulate(spring, 2);
    expect(final).toBeCloseTo(100, 1);
    expect(spring.settled).toBe(true);
  });

  it('is critically damped without overshoot for the soft preset', () => {
    const spring = new Spring(0, { stiffness: 220, damping: 2 * Math.sqrt(220) });
    spring.target = 1;
    expect(simulate(spring, 2).peak).toBeLessThanOrEqual(1.0001);
  });

  it('overshoots when under-damped (bouncy preset)', () => {
    const spring = new Spring(0, { stiffness: 380, damping: 18 });
    spring.target = 1;
    expect(simulate(spring, 2).peak).toBeGreaterThan(1.05);
  });

  it('snaps instantly and caps huge time steps', () => {
    const spring = new Spring(0);
    spring.snap(5);
    expect(spring.value).toBe(5);
    expect(spring.velocity).toBe(0);
    spring.target = 10;
    spring.step(10);
    expect(Number.isFinite(spring.value)).toBe(true);
  });
});

describe('smoothTowards', () => {
  it('rises faster than it falls', () => {
    const up = smoothTowards(0, 1, 0.016, 0.05, 0.3);
    const down = 1 - smoothTowards(1, 0, 0.016, 0.05, 0.3);
    expect(up).toBeGreaterThan(down);
  });

  it('jumps straight to the target without a time constant', () => {
    expect(smoothTowards(0.2, 0.9, 0.016, 0, 0)).toBe(0.9);
  });

  it('converges over time', () => {
    let value = 0;
    for (let i = 0; i < 120; i += 1) value = smoothTowards(value, 1, 1 / 60, 0.05, 0.3);
    expect(value).toBeGreaterThan(0.99);
  });
});

describe('numeric and colour helpers', () => {
  it('clamps and lerps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('parses hex colours (3 and 6 digits) and formats css', () => {
    expect(hexToRgb('#FFB300')).toEqual({ r: 255, g: 179, b: 0 });
    expect(hexToRgb('#0af')).toEqual({ r: 0, g: 170, b: 255 });
    expect(rgbToCss({ r: 1.4, g: 2.6, b: 3 })).toBe('rgb(1 3 3)');
    expect(rgbToCss({ r: 10, g: 20, b: 30 }, 0.5)).toBe('rgb(10 20 30 / 0.5)');
  });

  it('mixes colours and cycles through a palette with wrap-around', () => {
    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };
    expect(mixRgb(red, blue, 0.5)).toEqual({ r: 127.5, g: 0, b: 127.5 });
    expect(samplePalette([red, blue], 0)).toEqual(red);
    expect(samplePalette([red, blue], 1)).toEqual(blue);
    expect(samplePalette([red, blue], 2)).toEqual(red);
    expect(samplePalette([red, blue], -1)).toEqual(blue);
    const halfway = samplePalette([red, blue], 0.5);
    expect(halfway.r).toBeCloseTo(127.5);
    expect(samplePalette([], 3)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

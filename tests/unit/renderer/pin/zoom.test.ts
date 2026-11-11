import { describe, expect, it } from 'vitest';
import {
  arrowOffset,
  beyondDragThreshold,
  clampOpacity,
  clampScale,
  dragTarget,
  formatPercent,
  opacityFromWheel,
  stepScale,
  wheelPixels,
  zoomFromWheel,
} from '@renderer/pin/zoom';

describe('wheelPixels', () => {
  it('passes pixel deltas through and converts lines and pages', () => {
    expect(wheelPixels(120, 0)).toBe(120);
    expect(wheelPixels(3, 1)).toBe(99);
    expect(wheelPixels(1, 2)).toBe(400);
  });

  it('treats a broken delta as no movement', () => {
    expect(wheelPixels(Number.NaN, 0)).toBe(0);
    expect(wheelPixels(Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe('zoomFromWheel', () => {
  it('zooms in when scrolling up and out when scrolling down', () => {
    expect(zoomFromWheel(1, -100, 0)).toBeCloseTo(1.162, 2);
    expect(zoomFromWheel(1, 100, 0)).toBeCloseTo(0.861, 2);
  });

  it('compounds: two half notches equal one notch', () => {
    const twice = zoomFromWheel(zoomFromWheel(1, -50, 0), -50, 0);
    expect(twice).toBeCloseTo(zoomFromWheel(1, -100, 0), 10);
  });

  it('keeps the zoom between 10 % and 800 %', () => {
    expect(zoomFromWheel(7.9, -1000, 0)).toBe(8);
    expect(zoomFromWheel(0.11, 1000, 0)).toBe(0.1);
  });

  it('understands line-based wheels', () => {
    expect(zoomFromWheel(1, -3, 1)).toBeCloseTo(zoomFromWheel(1, -99, 0), 10);
  });

  it('leaves the zoom alone for a broken delta', () => {
    expect(zoomFromWheel(1.5, Number.NaN, 0)).toBe(1.5);
  });
});

describe('opacityFromWheel', () => {
  it('moves 5 points per notch: up is more opaque', () => {
    expect(opacityFromWheel(0.5, -100, 0)).toBe(0.55);
    expect(opacityFromWheel(0.5, 100, 0)).toBe(0.45);
  });

  it('stays between 10 % and 100 %', () => {
    expect(opacityFromWheel(0.98, -300, 0)).toBe(1);
    expect(opacityFromWheel(0.12, 300, 0)).toBe(0.1);
  });

  it('rounds to a whole percent', () => {
    expect(opacityFromWheel(0.5, -33, 0)).toBe(0.52);
  });
});

describe('clamping', () => {
  it('limits scale and opacity and falls back to 1 for numbers that are not finite', () => {
    expect(clampScale(0)).toBe(0.1);
    expect(clampScale(100)).toBe(8);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampOpacity(0)).toBe(0.1);
    expect(clampOpacity(3)).toBe(1);
    expect(clampOpacity(Number.NaN)).toBe(1);
  });
});

describe('stepScale', () => {
  it('steps by a quarter', () => {
    expect(stepScale(0.4, 1)).toBeCloseTo(0.5, 10);
    expect(stepScale(2, 1)).toBeCloseTo(2.5, 10);
    expect(stepScale(2, -1)).toBeCloseTo(1.6, 10);
  });

  it('stops exactly at 100 % when a step crosses or nears it', () => {
    expect(stepScale(0.8, 1)).toBe(1);
    expect(stepScale(0.9, 1)).toBe(1);
    expect(stepScale(1.25, -1)).toBe(1);
    expect(stepScale(1.1, -1)).toBe(1);
    expect(stepScale(1, 1)).toBeCloseTo(1.25, 10);
    expect(stepScale(1, -1)).toBeCloseTo(0.8, 10);
  });

  it('stays within the limits', () => {
    expect(stepScale(7, 1)).toBe(8);
    expect(stepScale(0.1, -1)).toBe(0.1);
  });
});

describe('dragTarget', () => {
  it('moves the window by the pointer travel, in whole pixels', () => {
    expect(dragTarget({ x: 100, y: 200 }, { x: 500, y: 500 }, { x: 530.4, y: 480 })).toEqual({
      x: 130,
      y: 180,
    });
  });

  it('does not depend on where in the window the drag started', () => {
    const origin = { x: -300, y: 40 };
    expect(dragTarget(origin, { x: 10, y: 10 }, { x: 10, y: 10 })).toEqual(origin);
  });
});

describe('beyondDragThreshold', () => {
  it('ignores the small jitter of a click', () => {
    expect(beyondDragThreshold({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(false);
    expect(beyondDragThreshold({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
  });

  it('starts a drag from 4 px, diagonals included', () => {
    expect(beyondDragThreshold({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
    expect(beyondDragThreshold({ x: 10, y: 10 }, { x: 13, y: 13 })).toBe(true);
  });
});

describe('arrowOffset', () => {
  it('moves 10 px per arrow and 50 px with Shift', () => {
    expect(arrowOffset('ArrowLeft', false)).toEqual({ x: -10, y: 0 });
    expect(arrowOffset('ArrowRight', true)).toEqual({ x: 50, y: 0 });
    expect(arrowOffset('ArrowUp', false)).toEqual({ x: 0, y: -10 });
    expect(arrowOffset('ArrowDown', true)).toEqual({ x: 0, y: 50 });
  });

  it('ignores every other key', () => {
    expect(arrowOffset('a', false)).toBeNull();
    expect(arrowOffset('constructor', false)).toBeNull();
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(0.754)).toBe('75%');
    expect(formatPercent(2)).toBe('200%');
  });
});

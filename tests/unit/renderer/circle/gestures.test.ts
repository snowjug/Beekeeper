import { describe, expect, it } from 'vitest';
import {
  classifyGesture,
  defaultKeyboardSelection,
  dragRect,
  MIN_SELECTION_PX,
  nudgeRect,
  smoothPath,
  type StrokePoint,
} from '@renderer/circle/gestures';
import { sceneOffsetFor } from '@renderer/circle/store';

const BOUNDS = { width: 1280, height: 720 };

function stroke(points: Array<[number, number]>, durationMs = 400): StrokePoint[] {
  return points.map(([x, y], index) => ({
    x,
    y,
    t: (index / Math.max(1, points.length - 1)) * durationMs,
    pressure: 0.5,
  }));
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  steps = 40,
): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
}

describe('classifyGesture', () => {
  it('turns a lasso into its padded bounding box', () => {
    const result = classifyGesture(stroke(ellipse(400, 300, 150, 60)), {
      rectangleMode: false,
      bounds: BOUNDS,
    });
    expect(result.kind).toBe('selection');
    if (result.kind !== 'selection') return;
    expect(result.source).toBe('lasso');
    expect(result.rect.x).toBeCloseTo(244, 0);
    expect(result.rect.width).toBeCloseTo(312, 0);
    expect(result.rect.height).toBeCloseTo(132, 0);
  });

  it('recognises a short press as a tap', () => {
    const result = classifyGesture(
      stroke(
        [
          [500, 400],
          [501, 401],
        ],
        90,
      ),
      {
        rectangleMode: false,
        bounds: BOUNDS,
      },
    );
    expect(result).toEqual({ kind: 'tap', point: { x: 500, y: 400 } });
  });

  it('a long press without movement is not a tap or a selection', () => {
    const result = classifyGesture(
      stroke(
        [
          [500, 400],
          [500, 400],
        ],
        2000,
      ),
      {
        rectangleMode: false,
        bounds: BOUNDS,
      },
    );
    expect(result.kind).toBe('ignored');
  });

  it('grows an underline scribble to a usable height', () => {
    const result = classifyGesture(
      stroke([
        [200, 300],
        [400, 302],
        [600, 299],
      ]),
      {
        rectangleMode: false,
        bounds: BOUNDS,
      },
    );
    expect(result.kind).toBe('selection');
    if (result.kind === 'selection')
      expect(result.rect.height).toBeGreaterThanOrEqual(MIN_SELECTION_PX);
  });

  it('Shift-drag makes a rectangle between the corners', () => {
    const result = classifyGesture(
      stroke([
        [600, 500],
        [300, 200],
      ]),
      { rectangleMode: true, bounds: BOUNDS },
    );
    expect(result).toEqual({
      kind: 'selection',
      source: 'rect',
      rect: { x: 300, y: 200, width: 300, height: 300 },
    });
  });

  it('keeps selections on the screen', () => {
    const result = classifyGesture(stroke(ellipse(1270, 710, 80, 80)), {
      rectangleMode: false,
      bounds: BOUNDS,
    });
    if (result.kind !== 'selection') throw new Error('expected a selection');
    expect(result.rect.x + result.rect.width).toBeLessThanOrEqual(BOUNDS.width);
    expect(result.rect.y + result.rect.height).toBeLessThanOrEqual(BOUNDS.height);
  });

  it('ignores tiny wiggles and empty strokes', () => {
    expect(classifyGesture([], { rectangleMode: false, bounds: BOUNDS }).kind).toBe('ignored');
    expect(
      classifyGesture(
        stroke(
          [
            [10, 10],
            [14, 12],
            [10, 14],
          ],
          600,
        ),
        { rectangleMode: false, bounds: BOUNDS },
      ).kind,
    ).toBe('ignored');
  });
});

describe('selection editing', () => {
  const rect = { x: 200, y: 200, width: 300, height: 120 };

  it('moves inside the screen', () => {
    expect(dragRect('move', rect, 50, -500, BOUNDS)).toEqual({
      x: 250,
      y: 0,
      width: 300,
      height: 120,
    });
    expect(dragRect('move', rect, 5000, 0, BOUNDS).x).toBe(980);
  });

  it('resizes from corners and edges with a minimum size', () => {
    expect(dragRect('se', rect, 40, 20, BOUNDS)).toEqual({
      x: 200,
      y: 200,
      width: 340,
      height: 140,
    });
    expect(dragRect('nw', rect, -40, -20, BOUNDS)).toEqual({
      x: 160,
      y: 180,
      width: 340,
      height: 140,
    });
    expect(dragRect('e', rect, -1000, 0, BOUNDS).width).toBe(MIN_SELECTION_PX);
    expect(dragRect('n', rect, 0, 1000, BOUNDS).height).toBe(MIN_SELECTION_PX);
  });

  it('arrow keys move, Shift+arrows resize, other keys do nothing', () => {
    const options = { resize: false, step: 8, bounds: BOUNDS };
    expect(nudgeRect(rect, 'ArrowRight', options)?.x).toBe(208);
    expect(nudgeRect(rect, 'ArrowUp', options)?.y).toBe(192);
    expect(nudgeRect(rect, 'ArrowDown', { ...options, resize: true })?.height).toBe(128);
    expect(nudgeRect(rect, 'a', options)).toBeNull();
  });

  it('offers a centred starting selection for keyboard users', () => {
    const start = defaultKeyboardSelection(BOUNDS);
    expect(start.x + start.width / 2).toBeCloseTo(BOUNDS.width / 2, 0);
    expect(start.y + start.height / 2).toBeCloseTo(BOUNDS.height / 2, 0);
  });
});

describe('smoothPath', () => {
  it('returns an evenly spaced, smoother path through the same area', () => {
    const raw = ellipse(300, 300, 100, 50, 12).map(([x, y]) => ({ x, y }));
    const smooth = smoothPath(raw);
    expect(smooth.length).toBeGreaterThan(raw.length);
    expect(smoothPath([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('sceneOffsetFor', () => {
  it('does not move the screen when the selection is above the sheet', () => {
    expect(sceneOffsetFor({ x: 100, y: 100, width: 300, height: 100 }, 720, 300)).toBe(0);
    expect(sceneOffsetFor(null, 720, 300)).toBe(0);
  });

  it('lifts a selection that the sheet would cover, but never past the top edge', () => {
    const low = sceneOffsetFor({ x: 100, y: 500, width: 300, height: 100 }, 720, 302);
    expect(low).toBeLessThan(0);
    expect(500 + 100 + low).toBeLessThanOrEqual(720 - 302 - 24 + 0.001);
    const huge = sceneOffsetFor({ x: 0, y: 40, width: 1280, height: 640 }, 720, 302);
    expect(huge).toBe(-16);
  });
});

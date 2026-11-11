import { describe, expect, it } from 'vitest';
import { distanceToSegment, hitOp, topOpAt } from '@renderer/studio/edit/hit';
import {
  arrowHead,
  constrainSquare,
  HIGHLIGHTER_FACTOR,
  opBounds,
  snapAngle,
  textExtent,
  thinStroke,
} from '@renderer/studio/edit/shapes';
import type { EditOp } from '@renderer/studio/edit/types';

describe('constrainSquare', () => {
  it('makes the box square, in whatever direction the drag went', () => {
    expect(constrainSquare({ x: 10, y: 10 }, { x: 60, y: 30 })).toEqual({ x: 60, y: 60 });
    expect(constrainSquare({ x: 10, y: 10 }, { x: -40, y: 20 })).toEqual({ x: -40, y: 60 });
    expect(constrainSquare({ x: 10, y: 10 }, { x: 20, y: -90 })).toEqual({ x: 110, y: -90 });
    expect(constrainSquare({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });
});

describe('snapAngle', () => {
  it('snaps to the nearest 45 degrees and keeps the length', () => {
    const snapped = snapAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(snapped.x).toBeCloseTo(Math.hypot(100, 10));
    expect(snapped.y).toBeCloseTo(0);
    const diagonal = snapAngle({ x: 0, y: 0 }, { x: 60, y: 70 });
    expect(diagonal.x).toBeCloseTo(diagonal.y);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(Math.hypot(60, 70));
    const up = snapAngle({ x: 5, y: 5 }, { x: 8, y: -100 });
    expect(up.x).toBeCloseTo(5, 0);
    expect(up.y).toBeLessThan(-90);
  });

  it('leaves a zero-length drag alone', () => {
    const point = { x: 3, y: 4 };
    expect(snapAngle(point, point)).toBe(point);
  });
});

describe('arrowHead', () => {
  it('puts the tip at the end and the back of the head on the shaft', () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 200, y: 0 }, 6);
    expect(head.tip).toEqual({ x: 200, y: 0 });
    expect(head.base.x).toBeLessThan(200);
    expect(head.base.y).toBeCloseTo(0);
    expect(head.left.y).toBeLessThan(0);
    expect(head.right.y).toBeGreaterThan(0);
    expect(head.left.x).toBeCloseTo(head.right.x);
  });

  it('scales with the stroke width and never covers more than 60 % of a short arrow', () => {
    const thin = arrowHead({ x: 0, y: 0 }, { x: 300, y: 0 }, 2);
    const thick = arrowHead({ x: 0, y: 0 }, { x: 300, y: 0 }, 12);
    expect(300 - thick.base.x).toBeGreaterThan(300 - thin.base.x);
    const short = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 12);
    expect(10 - short.left.x).toBeLessThanOrEqual(6.01);
  });
});

describe('thinStroke', () => {
  it('drops points that are too close together and keeps the last one', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 10, y: 0 },
      { x: 10.5, y: 0 },
    ];
    expect(thinStroke(points, 5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10.5, y: 0 },
    ]);
  });

  it('keeps a single point and handles an empty stroke', () => {
    expect(thinStroke([{ x: 1, y: 1 }], 5)).toEqual([{ x: 1, y: 1 }]);
    expect(thinStroke([], 5)).toEqual([]);
  });
});

describe('textExtent', () => {
  it('is as wide as the longest line and as high as the number of lines', () => {
    const one = textExtent('Hello', 20);
    const two = textExtent('Hello\nHi', 20);
    expect(two.width).toBe(one.width);
    expect(two.height).toBe(one.height * 2);
    expect(textExtent('', 20).width).toBeGreaterThan(0);
  });
});

const pen: EditOp = {
  id: 1,
  kind: 'pen',
  points: [
    { x: 10, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 60 },
  ],
  color: '#ff0000',
  width: 6,
};
const rect: EditOp = {
  id: 2,
  kind: 'rect',
  rect: { x: 100, y: 100, width: 80, height: 40 },
  color: '#00f',
  width: 4,
};
const ellipse: EditOp = {
  id: 3,
  kind: 'ellipse',
  rect: { x: 200, y: 100, width: 100, height: 60 },
  color: '#00f',
  width: 4,
};
const arrow: EditOp = {
  id: 4,
  kind: 'arrow',
  from: { x: 300, y: 300 },
  to: { x: 400, y: 300 },
  color: '#0f0',
  width: 6,
};
const text: EditOp = {
  id: 5,
  kind: 'text',
  at: { x: 50, y: 200 },
  text: 'Hello',
  color: '#000',
  size: 24,
};
const blur: EditOp = {
  id: 6,
  kind: 'blur',
  rect: { x: 500, y: 50, width: 100, height: 30 },
  mode: 'pixelate',
};
const highlighter: EditOp = {
  id: 7,
  kind: 'highlighter',
  points: [
    { x: 0, y: 400 },
    { x: 100, y: 400 },
  ],
  color: '#ff0',
  width: 5,
};

describe('distanceToSegment', () => {
  it('measures to the nearest point of the segment', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('hitOp', () => {
  it('hits a pen stroke near its line but not far from it', () => {
    expect(hitOp(pen, { x: 30, y: 12 }, 2)).toBe(true);
    expect(hitOp(pen, { x: 61, y: 40 }, 2)).toBe(true);
    expect(hitOp(pen, { x: 30, y: 40 }, 2)).toBe(false);
  });

  it('hits a single-dot stroke and ignores an empty one', () => {
    expect(hitOp({ ...pen, points: [{ x: 5, y: 5 }] }, { x: 6, y: 6 }, 1)).toBe(true);
    expect(hitOp({ ...pen, points: [] }, { x: 0, y: 0 }, 100)).toBe(false);
  });

  it('hits a highlighter within its wide stroke', () => {
    expect(hitOp(highlighter, { x: 50, y: 400 + (5 * HIGHLIGHTER_FACTOR) / 2 - 1 }, 0)).toBe(true);
    expect(hitOp(highlighter, { x: 50, y: 430 }, 0)).toBe(false);
  });

  it('hits a rectangle on its outline, not in the middle', () => {
    expect(hitOp(rect, { x: 100, y: 120 }, 2)).toBe(true);
    expect(hitOp(rect, { x: 140, y: 140 }, 2)).toBe(true);
    expect(hitOp(rect, { x: 140, y: 120 }, 2)).toBe(false);
  });

  it('hits an ellipse on its outline, not in the middle', () => {
    expect(hitOp(ellipse, { x: 200, y: 130 }, 2)).toBe(true);
    expect(hitOp(ellipse, { x: 250, y: 100 }, 2)).toBe(true);
    expect(hitOp(ellipse, { x: 250, y: 130 }, 2)).toBe(false);
  });

  it('hits a flat ellipse like a line', () => {
    const flat: EditOp = { ...ellipse, rect: { x: 0, y: 0, width: 100, height: 0 } };
    expect(hitOp(flat, { x: 50, y: 1 }, 2)).toBe(true);
  });

  it('hits an arrow along its shaft and at its head', () => {
    expect(hitOp(arrow, { x: 340, y: 302 }, 2)).toBe(true);
    expect(hitOp(arrow, { x: 395, y: 306 }, 3)).toBe(true);
    expect(hitOp(arrow, { x: 340, y: 340 }, 2)).toBe(false);
  });

  it('hits text and blurred regions anywhere inside them', () => {
    expect(hitOp(text, { x: 60, y: 210 }, 0)).toBe(true);
    expect(hitOp(text, { x: 60, y: 300 }, 0)).toBe(false);
    expect(hitOp(blur, { x: 550, y: 60 }, 0)).toBe(true);
    expect(hitOp(blur, { x: 450, y: 60 }, 0)).toBe(false);
  });
});

describe('topOpAt', () => {
  const ops = [rect, { ...blur, rect: { x: 90, y: 90, width: 200, height: 200 } } as EditOp, pen];

  it('finds the shape drawn last that is under the point', () => {
    expect(topOpAt(ops, { x: 120, y: 120 }, 2)).toBe(1);
    expect(topOpAt(ops, { x: 30, y: 12 }, 2)).toBe(2);
  });

  it('finds nothing where nothing is drawn', () => {
    expect(topOpAt(ops, { x: 700, y: 700 }, 2)).toBe(-1);
    expect(topOpAt([], { x: 0, y: 0 }, 2)).toBe(-1);
  });
});

describe('opBounds', () => {
  it('holds the whole shape including its stroke', () => {
    const penBounds = opBounds(pen);
    expect(penBounds.x).toBeLessThanOrEqual(7);
    expect(penBounds.y).toBeLessThanOrEqual(7);
    expect(penBounds.x + penBounds.width).toBeGreaterThanOrEqual(63);
    expect(opBounds(rect)).toEqual({ x: 98, y: 98, width: 84, height: 44 });
    expect(opBounds(blur)).toEqual({ x: 500, y: 50, width: 100, height: 30 });
    expect(opBounds(text)).toMatchObject({ x: 50, y: 200 });
    expect(opBounds(highlighter).height).toBeCloseTo(5 * HIGHLIGHTER_FACTOR);
    expect(opBounds(arrow).width).toBeGreaterThan(100);
    expect(opBounds(ellipse).width).toBe(104);
  });

  it('copes with a stroke that has no points', () => {
    expect(opBounds({ ...pen, points: [] }).width).toBeGreaterThan(0);
  });
});

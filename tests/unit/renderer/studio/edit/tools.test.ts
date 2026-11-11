import { describe, expect, it } from 'vitest';
import {
  MIN_SHAPE_CSS,
  shapeOp,
  strokeOp,
  textOp,
  toImageWidth,
  toTextSize,
} from '@renderer/studio/edit/tools';

const STYLE = { color: '#FF5A5F', width: 6 };

describe('toImageWidth / toTextSize', () => {
  it('make a stroke look as wide on the picture as it did on screen', () => {
    expect(toImageWidth(6, 1)).toBe(6);
    expect(toImageWidth(6, 0.5)).toBe(12);
    expect(toImageWidth(6, 2)).toBe(3);
    expect(toImageWidth(0.1, 4)).toBe(1);
  });

  it('size text after the width slider', () => {
    expect(toTextSize(6, 1)).toBe(28);
    expect(toTextSize(6, 0.5)).toBe(56);
    expect(toTextSize(24, 1)).toBeGreaterThan(toTextSize(6, 1));
  });

  it('survive a zero scale', () => {
    expect(Number.isFinite(toImageWidth(6, 0))).toBe(true);
    expect(Number.isFinite(toTextSize(6, 0))).toBe(true);
  });
});

describe('strokeOp', () => {
  it('copies the points and uses the colour and scaled width', () => {
    const points = [
      { x: 1, y: 1 },
      { x: 5, y: 5 },
    ];
    const op = strokeOp('pen', points, STYLE, 0.5);
    expect(op).toEqual({ kind: 'pen', points, color: '#FF5A5F', width: 12 });
    expect(op.kind === 'pen' && op.points).not.toBe(points);
    expect(strokeOp('highlighter', points, STYLE, 1).kind).toBe('highlighter');
  });
});

describe('shapeOp', () => {
  const start = { x: 100, y: 100 };

  it('makes a rectangle whichever direction it was dragged', () => {
    expect(shapeOp('rect', start, { x: 60, y: 40 }, STYLE, 'pixelate', 1, false)).toEqual({
      kind: 'rect',
      rect: { x: 60, y: 40, width: 40, height: 60 },
      color: '#FF5A5F',
      width: 6,
    });
  });

  it('makes ellipses, arrows and blurred regions', () => {
    expect(
      shapeOp('ellipse', start, { x: 200, y: 160 }, STYLE, 'pixelate', 1, false),
    ).toMatchObject({
      kind: 'ellipse',
      rect: { x: 100, y: 100, width: 100, height: 60 },
    });
    expect(shapeOp('arrow', start, { x: 200, y: 160 }, STYLE, 'pixelate', 1, false)).toMatchObject({
      kind: 'arrow',
      from: start,
      to: { x: 200, y: 160 },
    });
    expect(shapeOp('blur', start, { x: 200, y: 130 }, STYLE, 'blur', 1, false)).toEqual({
      kind: 'blur',
      rect: { x: 100, y: 100, width: 100, height: 30 },
      mode: 'blur',
    });
  });

  it('keeps shapes square and arrows on 45 degree angles with Shift', () => {
    const square = shapeOp('rect', start, { x: 200, y: 130 }, STYLE, 'pixelate', 1, true);
    expect(square).toMatchObject({ rect: { width: 100, height: 100 } });
    const arrow = shapeOp('arrow', start, { x: 200, y: 108 }, STYLE, 'pixelate', 1, true);
    expect(arrow?.kind === 'arrow' && arrow.to.y).toBeCloseTo(100);
  });

  it('treats a tiny drag as a click and draws nothing', () => {
    expect(shapeOp('rect', start, { x: 101, y: 101 }, STYLE, 'pixelate', 1, false)).toBeNull();
    // The limit is in screen pixels: at half scale it takes twice as many image pixels.
    expect(shapeOp('rect', start, { x: 106, y: 100 }, STYLE, 'pixelate', 0.5, false)).toBeNull();
    expect(
      shapeOp('rect', start, { x: 100 + MIN_SHAPE_CSS, y: 100 }, STYLE, 'pixelate', 1, false),
    ).not.toBeNull();
  });
});

describe('textOp', () => {
  it('keeps the text and scales its size', () => {
    expect(textOp({ x: 5, y: 6 }, 'Hello\nWorld  \n', STYLE, 0.5)).toEqual({
      kind: 'text',
      at: { x: 5, y: 6 },
      text: 'Hello\nWorld',
      color: '#FF5A5F',
      size: 56,
    });
  });

  it('draws nothing for an empty text', () => {
    expect(textOp({ x: 0, y: 0 }, '', STYLE, 1)).toBeNull();
    expect(textOp({ x: 0, y: 0 }, '  \n ', STYLE, 1)).toBeNull();
  });
});

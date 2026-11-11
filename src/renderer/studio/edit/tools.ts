/** Turns pointer input into drawing ops: stroke widths follow what the user sees, shapes may be constrained. */
import { rectFromPoints, type Point } from '@shared/geometry';
import { constrainSquare, snapAngle } from './shapes';
import type { BlurMode, NewOp, StrokeStyle } from './types';

/** A drag shorter than this (screen pixels) is a click, not a shape. */
export const MIN_SHAPE_CSS = 4;

/** Line width in image pixels for a width the user picked in screen pixels. */
export function toImageWidth(widthCss: number, cssScale: number): number {
  return Math.max(1, widthCss / Math.max(cssScale, 1e-6));
}

/** Font size in image pixels: the width slider also sets the text size. */
export function toTextSize(widthCss: number, cssScale: number): number {
  return (widthCss * 3 + 10) / Math.max(cssScale, 1e-6);
}

export function strokeOp(
  tool: 'pen' | 'highlighter',
  points: readonly Point[],
  style: StrokeStyle,
  cssScale: number,
): NewOp {
  return {
    kind: tool,
    points: [...points],
    color: style.color,
    width: toImageWidth(style.width, cssScale),
  };
}

export type ShapeTool = 'arrow' | 'rect' | 'ellipse' | 'blur';

/** The shape dragged from `start` to `end`; `constrain` (Shift) makes it square or snaps an arrow to 45 degrees. */
export function shapeOp(
  tool: ShapeTool,
  start: Point,
  end: Point,
  style: StrokeStyle,
  blurMode: BlurMode,
  cssScale: number,
  constrain: boolean,
): NewOp | null {
  const target = constrain
    ? tool === 'arrow'
      ? snapAngle(start, end)
      : constrainSquare(start, end)
    : end;
  if (
    Math.hypot(target.x - start.x, target.y - start.y) <
    MIN_SHAPE_CSS / Math.max(cssScale, 1e-6)
  ) {
    return null;
  }
  const width = toImageWidth(style.width, cssScale);
  switch (tool) {
    case 'arrow':
      return { kind: 'arrow', from: start, to: target, color: style.color, width };
    case 'rect':
      return { kind: 'rect', rect: rectFromPoints(start, target), color: style.color, width };
    case 'ellipse':
      return { kind: 'ellipse', rect: rectFromPoints(start, target), color: style.color, width };
    case 'blur':
      return { kind: 'blur', rect: rectFromPoints(start, target), mode: blurMode };
  }
}

/** The text typed at `at`, or null when there is nothing but white space. */
export function textOp(
  at: Point,
  text: string,
  style: StrokeStyle,
  cssScale: number,
): NewOp | null {
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed.trim() === '') return null;
  return {
    kind: 'text',
    at,
    text: trimmed,
    color: style.color,
    size: toTextSize(style.width, cssScale),
  };
}

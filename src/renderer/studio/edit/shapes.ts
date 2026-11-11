/** Geometry of the drawing tools: constrained drags, arrow heads, stroke thinning, shape bounds. */
import {
  boundingBox,
  expandRect,
  normalizeRect,
  distance,
  type Point,
  type Rect,
} from '@shared/geometry';
import type { EditOp } from './types';

/** The highlighter is a wide, see-through stroke: this many times the pen width. */
export const HIGHLIGHTER_FACTOR = 3.2;

/** Arrow heads are at least this long (image pixels) and never more than 60 % of the arrow. */
const MIN_HEAD = 14;
const HEAD_SPREAD = Math.PI / 7;
const TEXT_ADVANCE = 0.56;
const TEXT_LINE_HEIGHT = 1.25;

/** Moves `to` so the box from `from` to `to` is square (Shift while drawing a rectangle or ellipse). */
export function constrainSquare(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + (dx < 0 ? -side : side), y: from.y + (dy < 0 ? -side : side) };
}

/** Moves `to` onto the nearest multiple of `step` radians around `from` (Shift while drawing an arrow). */
export function snapAngle(from: Point, to: Point, step = Math.PI / 4): Point {
  const length = distance(from, to);
  if (length === 0) return to;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

export interface ArrowHead {
  tip: Point;
  left: Point;
  right: Point;
  /** Where the shaft ends, in the middle of the head's back edge. */
  base: Point;
}

/** The triangle at the end of an arrow from `from` to `to`, sized after the stroke width. */
export function arrowHead(from: Point, to: Point, width: number): ArrowHead {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.min(Math.max(width * 4.5, MIN_HEAD), distance(from, to) * 0.6);
  const corner = (side: number): Point => ({
    x: to.x - length * Math.cos(angle + side),
    y: to.y - length * Math.sin(angle + side),
  });
  const left = corner(HEAD_SPREAD);
  const right = corner(-HEAD_SPREAD);
  return { tip: to, left, right, base: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } };
}

/** Drops the points of a pen stroke that are closer than `minDistance` to the previous one (the last is kept). */
export function thinStroke(points: readonly Point[], minDistance: number): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (!previous || distance(previous, point) >= minDistance) kept.push(point);
  }
  const last = points[points.length - 1];
  if (last && kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/** An estimate of a text's size in image pixels (the canvas measures the real text when it draws). */
export function textExtent(text: string, size: number): { width: number; height: number } {
  const lines = text.split('\n');
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return { width: longest * size * TEXT_ADVANCE, height: lines.length * size * TEXT_LINE_HEIGHT };
}

/** Smallest axis-aligned rectangle that holds everything the op draws. */
export function opBounds(op: EditOp): Rect {
  switch (op.kind) {
    case 'pen':
    case 'highlighter': {
      const box = boundingBox(op.points) ?? { x: 0, y: 0, width: 0, height: 0 };
      const width = op.kind === 'highlighter' ? op.width * HIGHLIGHTER_FACTOR : op.width;
      return expandRect(box, width / 2);
    }
    case 'arrow':
      return expandRect(
        boundingBox([op.from, op.to]) ?? { x: 0, y: 0, width: 0, height: 0 },
        Math.max(op.width / 2, op.width * 2),
      );
    case 'rect':
    case 'ellipse':
      return expandRect(normalizeRect(op.rect), op.width / 2);
    case 'text':
      return { ...op.at, ...textExtent(op.text, op.size) };
    case 'blur':
      return normalizeRect(op.rect);
  }
}

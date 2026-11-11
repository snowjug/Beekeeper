/** Hit testing of drawn shapes: which one is under the pointer (used by the eraser). */
import {
  distance,
  expandRect,
  normalizeRect,
  rectContainsPoint,
  type Point,
  type Rect,
} from '@shared/geometry';
import { arrowHead, HIGHLIGHTER_FACTOR, opBounds } from './shapes';
import type { EditOp } from './types';

/** Shortest distance from `point` to the segment a-b. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, a);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function distanceToPolyline(point: Point, points: readonly Point[]): number {
  const first = points[0];
  if (!first) return Infinity;
  if (points.length === 1) return distance(point, first);
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from && to) best = Math.min(best, distanceToSegment(point, from, to));
  }
  return best;
}

function distanceToRectOutline(point: Point, rect: Rect): number {
  const { x, y, width, height } = normalizeRect(rect);
  const corners: Point[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
  return distanceToPolyline(point, corners);
}

function distanceToEllipseOutline(point: Point, rect: Rect): number {
  const { x, y, width, height } = normalizeRect(rect);
  const radiusX = width / 2;
  const radiusY = height / 2;
  if (radiusX === 0 || radiusY === 0) {
    return distanceToSegment(point, { x, y }, { x: x + width, y: y + height });
  }
  const normalized = Math.hypot(
    (point.x - (x + radiusX)) / radiusX,
    (point.y - (y + radiusY)) / radiusY,
  );
  return Math.abs(normalized - 1) * Math.min(radiusX, radiusY);
}

/** True when `point` touches the op, with `tolerance` image pixels of leeway around thin lines. */
export function hitOp(op: EditOp, point: Point, tolerance: number): boolean {
  switch (op.kind) {
    case 'pen':
      return distanceToPolyline(point, op.points) <= op.width / 2 + tolerance;
    case 'highlighter':
      return (
        distanceToPolyline(point, op.points) <= (op.width * HIGHLIGHTER_FACTOR) / 2 + tolerance
      );
    case 'arrow': {
      const head = arrowHead(op.from, op.to, op.width);
      const reach = op.width / 2 + tolerance;
      return (
        distanceToSegment(point, op.from, head.base) <= reach ||
        distanceToSegment(point, head.left, head.tip) <= reach ||
        distanceToSegment(point, head.right, head.tip) <= reach ||
        distanceToSegment(point, head.left, head.right) <= reach
      );
    }
    case 'rect':
      return distanceToRectOutline(point, op.rect) <= op.width / 2 + tolerance;
    case 'ellipse':
      return distanceToEllipseOutline(point, op.rect) <= op.width / 2 + tolerance;
    case 'text':
    case 'blur':
      return rectContainsPoint(expandRect(opBounds(op), tolerance), point);
  }
}

/** Index of the op drawn last that is under `point`, or -1. */
export function topOpAt(ops: readonly EditOp[], point: Point, tolerance: number): number {
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index];
    if (op && hitOp(op, point, tolerance)) return index;
  }
  return -1;
}

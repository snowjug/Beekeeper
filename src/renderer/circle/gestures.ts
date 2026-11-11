import {
  boundingBox,
  chaikin,
  clampRect,
  expandRect,
  isTap,
  rectFromPoints,
  resamplePath,
  type Point,
  type Rect,
  type Size,
} from '@shared/geometry';

export interface StrokePoint extends Point {
  /** performance.now() timestamp of the sample. */
  t: number;
  /** 0..1 (pen pressure; mouse and touch report a constant). */
  pressure: number;
}

export type GestureResult =
  | { kind: 'tap'; point: Point }
  | { kind: 'selection'; rect: Rect; source: 'lasso' | 'rect' }
  | { kind: 'ignored' };

export const TAP_MAX_MOVE_PX = 6;
export const TAP_MAX_MS = 350;
/** Smallest selection a drag may create; thinner scribbles (underlines) grow to this size. */
export const MIN_SELECTION_PX = 28;
const LASSO_PADDING_PX = 6;
const MIN_RECT_DRAG_PX = 14;
const MIN_LASSO_TRAVEL_PX = 18;

function growTo(rect: Rect, minimum: number): Rect {
  const width = Math.max(rect.width, minimum);
  const height = Math.max(rect.height, minimum);
  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width,
    height,
  };
}

/** Moves a rect back inside the screen without changing its size. */
function keepInside(rect: Rect, bounds: Size): Rect {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    x: Math.min(Math.max(rect.x, 0), bounds.width - width),
    y: Math.min(Math.max(rect.y, 0), bounds.height - height),
    width,
    height,
  };
}

/**
 * Decides what a finished pointer stroke means: a tap (select the word under it), a closed or
 * scribbled lasso (its bounding box becomes the selection), a Shift-drag rectangle, or nothing.
 */
export function classifyGesture(
  points: readonly StrokePoint[],
  options: { rectangleMode: boolean; bounds: Size },
): GestureResult {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { kind: 'ignored' };
  const duration = last.t - first.t;

  if (isTap(points, TAP_MAX_MOVE_PX, duration, TAP_MAX_MS)) {
    return { kind: 'tap', point: { x: first.x, y: first.y } };
  }

  const screen = { x: 0, y: 0, width: options.bounds.width, height: options.bounds.height };
  if (options.rectangleMode) {
    const rect = rectFromPoints(first, last);
    if (rect.width < MIN_RECT_DRAG_PX && rect.height < MIN_RECT_DRAG_PX) {
      return { kind: 'ignored' };
    }
    return {
      kind: 'selection',
      source: 'rect',
      rect: keepInside(growTo(clampRect(rect, screen), MIN_SELECTION_PX), options.bounds),
    };
  }

  const box = boundingBox(points);
  if (!box || Math.hypot(box.width, box.height) < MIN_LASSO_TRAVEL_PX) {
    return { kind: 'ignored' };
  }
  const padded = clampRect(expandRect(box, LASSO_PADDING_PX), screen);
  return {
    kind: 'selection',
    source: 'lasso',
    rect: keepInside(growTo(padded, MIN_SELECTION_PX), options.bounds),
  };
}

const SMOOTHING_SPACING_PX = 4;
const SMOOTHING_ITERATIONS = 2;

/** Evenly spaced, Chaikin-smoothed copy of a raw pointer path (for drawing only). */
export function smoothPath(points: readonly Point[]): Point[] {
  if (points.length < 3) return points.map((point) => ({ x: point.x, y: point.y }));
  return chaikin(resamplePath(points, SMOOTHING_SPACING_PX), SMOOTHING_ITERATIONS);
}

export type HandleEdge = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The selection after dragging a handle (or its body) by `dx`/`dy`, kept on screen and >= min size. */
export function dragRect(
  edge: HandleEdge,
  start: Rect,
  dx: number,
  dy: number,
  bounds: Size,
  minSize = MIN_SELECTION_PX,
): Rect {
  if (edge === 'move') {
    return {
      x: clampNumber(start.x + dx, 0, bounds.width - start.width),
      y: clampNumber(start.y + dy, 0, bounds.height - start.height),
      width: start.width,
      height: start.height,
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (edge.includes('w')) left = clampNumber(left + dx, 0, right - minSize);
  if (edge.includes('e')) right = clampNumber(right + dx, left + minSize, bounds.width);
  if (edge.includes('n')) top = clampNumber(top + dy, 0, bottom - minSize);
  if (edge.includes('s')) bottom = clampNumber(bottom + dy, top + minSize, bounds.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/** Keyboard editing of the selection: arrows move it, Shift+arrows resize it from the bottom-right. */
export function nudgeRect(
  rect: Rect,
  key: string,
  options: { resize: boolean; step: number; bounds: Size },
): Rect | null {
  const arrow = ARROWS[key];
  if (!arrow) return null;
  const dx = arrow.dx * options.step;
  const dy = arrow.dy * options.step;
  return options.resize
    ? dragRect('se', rect, dx, dy, options.bounds)
    : dragRect('move', rect, dx, dy, options.bounds);
}

/** A centred starting selection for keyboard users (60 % of the screen). */
export function defaultKeyboardSelection(bounds: Size): Rect {
  const width = Math.round(bounds.width * 0.6);
  const height = Math.round(bounds.height * 0.4);
  return {
    x: Math.round((bounds.width - width) / 2),
    y: Math.round((bounds.height - height) / 2),
    width,
    height,
  };
}

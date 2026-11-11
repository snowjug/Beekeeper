/** Pure input handling of a pinned screenshot: wheel to zoom and opacity, dragging, keyboard steps. */
import type { Point } from '@shared/geometry';

/** The limits the `pin:action` schema accepts (the main process narrows them to the image). */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
export const MIN_OPACITY = 0.1;
export const MAX_OPACITY = 1;
/** Pointer travel (px) before a press becomes a drag, so a click or double-click never moves the pin. */
export const DRAG_THRESHOLD = 4;

const LINE_PIXELS = 33;
const PAGE_PIXELS = 400;
/** A mouse-wheel notch (100 px) zooms by about 16 %. */
const ZOOM_PER_PIXEL = 0.0015;
/** A mouse-wheel notch changes the opacity by 5 points. */
const OPACITY_PER_PIXEL = 0.0005;
const KEY_ZOOM_STEP = 1.25;
/** A keyboard zoom that lands this close to 100 % snaps to it. */
const SNAP_TO_ACTUAL = 0.02;
const MOVE_STEP = 10;
const MOVE_STEP_LARGE = 50;

const ARROWS = new Map<string, Point>([
  ['ArrowLeft', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
  ['ArrowUp', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampScale(scale: number): number {
  return clamp(Number.isFinite(scale) ? scale : 1, MIN_SCALE, MAX_SCALE);
}

export function clampOpacity(opacity: number): number {
  return clamp(Number.isFinite(opacity) ? opacity : 1, MIN_OPACITY, MAX_OPACITY);
}

/** A wheel delta in pixels, whatever unit the device reports (0 = pixels, 1 = lines, 2 = pages). */
export function wheelPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * LINE_PIXELS;
  if (deltaMode === 2) return delta * PAGE_PIXELS;
  return delta;
}

/** The zoom after a wheel turn: scrolling up zooms in, and the steps compound smoothly. */
export function zoomFromWheel(scale: number, delta: number, deltaMode: number): number {
  return clampScale(scale * Math.exp(-wheelPixels(delta, deltaMode) * ZOOM_PER_PIXEL));
}

/** The opacity after a Ctrl+wheel turn: scrolling up makes the pin more opaque, in whole percents. */
export function opacityFromWheel(opacity: number, delta: number, deltaMode: number): number {
  const next = opacity - wheelPixels(delta, deltaMode) * OPACITY_PER_PIXEL;
  return clampOpacity(Math.round(next * 100) / 100);
}

/** The next keyboard zoom step; stepping over (or next to) 100 % stops exactly at it. */
export function stepScale(scale: number, direction: 1 | -1): number {
  const next = direction > 0 ? scale * KEY_ZOOM_STEP : scale / KEY_ZOOM_STEP;
  const crossesActual = (scale < 1 && next > 1) || (scale > 1 && next < 1);
  if (crossesActual || Math.abs(next - 1) <= SNAP_TO_ACTUAL) return 1;
  return clampScale(next);
}

/** Where the window's top-left corner goes when the pointer moves from `from` to `to` (screen DIPs). */
export function dragTarget(origin: Point, from: Point, to: Point): Point {
  return { x: Math.round(origin.x + to.x - from.x), y: Math.round(origin.y + to.y - from.y) };
}

export function beyondDragThreshold(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;
}

/** How far an arrow key moves the pin (Shift = a larger step); null for any other key. */
export function arrowOffset(key: string, large: boolean): Point | null {
  const direction = ARROWS.get(key);
  if (!direction) return null;
  const step = large ? MOVE_STEP_LARGE : MOVE_STEP;
  return { x: direction.x * step, y: direction.y * step };
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

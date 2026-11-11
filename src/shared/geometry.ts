/**
 * Pure 2-D geometry shared by the Circle to Search overlay (renderer) and the capture code (main).
 * No DOM and no Electron: everything works on plain `{ x, y, width, height }` objects.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of an Electron `Display` the coordinate mapping needs. `bounds` is in DIPs in the same
 * space as the points that are mapped: global desktop coordinates for real displays (the origin of
 * a monitor left of / above the primary one is negative), or `{ x: 0, y: 0, ... }` for pointer
 * positions relative to a window that covers the display.
 */
export interface DisplayGeometry {
  bounds: Rect;
  scaleFactor: number;
}

export interface StrokeWidthRange {
  min: number;
  max: number;
  /** Speed (px/ms) at which the width has eased about two thirds of the way from max to min. Default 1.6. */
  referenceVelocity?: number;
}

const EPSILON = 1e-6;
const DEFAULT_REFERENCE_VELOCITY = 1.6;
const MAX_CHAIKIN_ITERATIONS = 8;
const MAX_RESAMPLED_POINTS = 20_000;
const ARC_SEGMENTS = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function positiveScale(factor: number): number {
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---------------------------------------------------------------------------------------------
// Rectangles
// ---------------------------------------------------------------------------------------------

/** Smallest rect containing all points, or null for an empty path. */
export function boundingBox(points: readonly Point[]): Rect | null {
  const first = points[0];
  if (!first) return null;
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Rect spanned by two corners, whatever direction the drag went. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Gives a rect with negative width/height the equivalent non-negative size. */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/** Grows the rect by `pad` on every side; a negative pad shrinks it (collapsing onto its centre). */
export function expandRect(rect: Rect, pad: number): Rect {
  const source = normalizeRect(rect);
  const width = Math.max(0, source.width + 2 * pad);
  const height = Math.max(0, source.height + 2 * pad);
  return {
    x: source.x + (source.width - width) / 2,
    y: source.y + (source.height - height) / 2,
    width,
    height,
  };
}

/** The part of `rect` inside `bounds` (every edge is clamped, so it may collapse to zero size). */
export function clampRect(rect: Rect, bounds: Rect): Rect {
  const source = normalizeRect(rect);
  const limit = normalizeRect(bounds);
  const left = clamp(source.x, limit.x, limit.x + limit.width);
  const top = clamp(source.y, limit.y, limit.y + limit.height);
  const right = clamp(source.x + source.width, limit.x, limit.x + limit.width);
  const bottom = clamp(source.y + source.height, limit.y, limit.y + limit.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Moves `rect` (keeping its size) so it lies inside `bounds`; it is clipped if it cannot fit. */
export function shiftRectInside(rect: Rect, bounds: Rect): Rect {
  const source = normalizeRect(rect);
  const limit = normalizeRect(bounds);
  const width = Math.min(source.width, limit.width);
  const height = Math.min(source.height, limit.height);
  return {
    x: clamp(source.x, limit.x, limit.x + limit.width - width),
    y: clamp(source.y, limit.y, limit.y + limit.height - height),
    width,
    height,
  };
}

/** Edges count as inside. */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
  const source = normalizeRect(rect);
  return (
    point.x >= source.x &&
    point.x <= source.x + source.width &&
    point.y >= source.y &&
    point.y <= source.y + source.height
  );
}

/** Overlapping area of two rects; rects that only touch do not intersect. */
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const first = normalizeRect(a);
  const second = normalizeRect(b);
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function rectArea(rect: Rect): number {
  return Math.abs(rect.width * rect.height);
}

export function rectCenter(rect: Rect): Point {
  const source = normalizeRect(rect);
  return { x: source.x + source.width / 2, y: source.y + source.height / 2 };
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

/** Length of the polyline; `closed` adds the segment from the last point back to the first. */
export function pathLength(points: readonly Point[], closed = false): number {
  let total = 0;
  let previous: Point | undefined;
  for (const point of points) {
    if (previous) total += distance(previous, point);
    previous = point;
  }
  const first = points[0];
  if (closed && first && previous && previous !== first) total += distance(previous, first);
  return total;
}

function chaikinOpen(points: readonly Point[]): Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  const result: Point[] = [copyPoint(first)];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    result.push(lerpPoint(a, b, 0.25), lerpPoint(a, b, 0.75));
  }
  result.push(copyPoint(last));
  return result;
}

function chaikinClosed(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (!a || !b) continue;
    result.push(lerpPoint(a, b, 0.25), lerpPoint(a, b, 0.75));
  }
  return result;
}

/**
 * Chaikin corner cutting. Open curves keep their first and last point; a closed curve is a ring
 * (a final point equal to the first one is dropped, close it again when drawing).
 */
export function chaikin(points: readonly Point[], iterations = 2, closed = false): Point[] {
  let current = points.map(copyPoint);
  const first = current[0];
  const last = current[current.length - 1];
  if (closed && current.length > 1 && first && last && distance(first, last) < EPSILON) {
    current.pop();
  }
  const rounds = Number.isFinite(iterations)
    ? clamp(Math.floor(iterations), 0, MAX_CHAIKIN_ITERATIONS)
    : 0;
  for (let round = 0; round < rounds && current.length >= 3; round += 1) {
    current = closed ? chaikinClosed(current) : chaikinOpen(current);
  }
  return current;
}

/** Points every `spacing` px along the polyline; the first and last point are always kept. */
export function resamplePath(points: readonly Point[], spacing: number): Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  if (points.length < 2 || !Number.isFinite(spacing) || spacing <= 0) {
    return points.map(copyPoint);
  }
  const total = pathLength(points);
  const step = Math.max(spacing, total / MAX_RESAMPLED_POINTS);
  const result: Point[] = [copyPoint(first)];
  let nextAt = step;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (!a || !b) continue;
    const length = distance(a, b);
    if (length === 0) continue;
    while (nextAt <= travelled + length + EPSILON) {
      result.push(lerpPoint(a, b, clamp((nextAt - travelled) / length, 0, 1)));
      nextAt += step;
    }
    travelled += length;
  }
  const lastSample = result[result.length - 1];
  if (lastSample && distance(lastSample, last) > EPSILON) result.push(copyPoint(last));
  return result;
}

/**
 * Exactly `count` points evenly spaced along the path. Open paths include both end points; for a
 * closed ring the closing segment is included and no point is repeated.
 */
export function resampleToCount(points: readonly Point[], count: number, closed = false): Point[] {
  const target = Math.floor(count);
  const first = points[0];
  if (!first || !(target > 0)) return [];
  const ring = closed ? [...points, first] : [...points];
  const total = pathLength(ring);
  if (total < EPSILON || target === 1) {
    return Array.from({ length: target }, () => copyPoint(first));
  }
  const step = closed ? total / target : total / (target - 1);
  const result: Point[] = [];
  let segment = 1;
  let travelled = 0;
  for (let index = 0; index < target; index += 1) {
    const wanted = index * step;
    let a = ring[segment - 1];
    let b = ring[segment];
    while (a && b && segment < ring.length - 1 && travelled + distance(a, b) < wanted - EPSILON) {
      travelled += distance(a, b);
      segment += 1;
      a = ring[segment - 1];
      b = ring[segment];
    }
    if (!a || !b) break;
    const length = distance(a, b);
    result.push(
      length < EPSILON ? copyPoint(b) : lerpPoint(a, b, clamp((wanted - travelled) / length, 0, 1)),
    );
  }
  return result;
}

/** Shoelace area; positive when a closed path runs clockwise on screen (y axis pointing down). */
export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a && b) sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function roundedRectPolygon(rect: Rect, radius: number): Point[] {
  const { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;
  if (radius <= 0) {
    return [
      { x, y },
      { x: right, y },
      { x: right, y: bottom },
      { x, y: bottom },
    ];
  }
  const corners: Array<{ cx: number; cy: number; from: number }> = [
    { cx: right - radius, cy: y + radius, from: -Math.PI / 2 },
    { cx: right - radius, cy: bottom - radius, from: 0 },
    { cx: x + radius, cy: bottom - radius, from: Math.PI / 2 },
    { cx: x + radius, cy: y + radius, from: Math.PI },
  ];
  const polygon: Point[] = [];
  for (const { cx, cy, from } of corners) {
    for (let step = 0; step <= ARC_SEGMENTS; step += 1) {
      const angle = from + (step / ARC_SEGMENTS) * (Math.PI / 2);
      polygon.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
  }
  return polygon;
}

/**
 * Closed outline of a rounded rectangle as `count` evenly spaced points, ready to be morphed from
 * a lasso that was resampled to the same count. `startNear` rotates the ring so its first point is
 * the one closest to that point; `clockwise: false` reverses the winding (default clockwise).
 */
export function roundedRectOutline(
  rect: Rect,
  radius: number,
  count: number,
  options: { startNear?: Point; clockwise?: boolean } = {},
): Point[] {
  const source = normalizeRect(rect);
  const corner = clamp(
    Number.isFinite(radius) ? radius : 0,
    0,
    Math.min(source.width, source.height) / 2,
  );
  let outline = resampleToCount(roundedRectPolygon(source, corner), count, true);
  if (options.clockwise === false) {
    const [head, ...rest] = outline;
    if (head) outline = [head, ...rest.reverse()];
  }
  const anchor = options.startNear;
  if (!anchor || outline.length === 0) return outline;
  let nearest = 0;
  let nearestDistance = Infinity;
  outline.forEach((point, index) => {
    const d = distance(point, anchor);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = index;
    }
  });
  return [...outline.slice(nearest), ...outline.slice(0, nearest)];
}

/** Point-by-point interpolation (`t` 0 = `from`, 1 = `to`); both paths should have the same length. */
export function morphPoints(from: readonly Point[], to: readonly Point[], t: number): Point[] {
  return from.map((point, index) => lerpPoint(point, to[index] ?? point, t));
}

// ---------------------------------------------------------------------------------------------
// Pointer gestures
// ---------------------------------------------------------------------------------------------

/**
 * Stroke width for the current pointer speed: still = `max`, fast = `min`, easing smoothly in
 * between and never leaving the range.
 */
export function strokeWidthForVelocity(velocityPxPerMs: number, range: StrokeWidthRange): number {
  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  const reference =
    range.referenceVelocity !== undefined && range.referenceVelocity > 0
      ? range.referenceVelocity
      : DEFAULT_REFERENCE_VELOCITY;
  const speed = Number.isNaN(velocityPxPerMs) ? 0 : Math.max(0, velocityPxPerMs);
  const progress = 1 - Math.exp(-speed / reference);
  const eased = progress * progress * (3 - 2 * progress);
  return clamp(max - (max - min) * eased, min, max);
}

/**
 * True when the stroke came back to where it started (within `thresholdPx`) after sweeping an
 * area at least `thresholdPx` wide and tall, i.e. it is a loop and not a tap or a back-and-forth scribble.
 */
export function isLassoClosed(points: readonly Point[], thresholdPx: number): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 3 || !first || !last) return false;
  if (distance(first, last) > thresholdPx) return false;
  const box = boundingBox(points);
  return box !== null && box.width >= thresholdPx && box.height >= thresholdPx;
}

/** A tap is a short press whose pointer never wandered further than `maxMovePx` from where it went down. */
export function isTap(
  points: readonly Point[],
  maxMovePx: number,
  durationMs: number,
  maxDurationMs: number,
): boolean {
  const first = points[0];
  if (!first || durationMs > maxDurationMs) return false;
  return points.every((point) => distance(first, point) <= maxMovePx);
}

// ---------------------------------------------------------------------------------------------
// DIP <-> pixel mapping
// ---------------------------------------------------------------------------------------------

export function dipToPixels(rect: Rect, scaleFactor: number): Rect {
  const scale = positiveScale(scaleFactor);
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function pixelsToDip(rect: Rect, scaleFactor: number): Rect {
  const scale = positiveScale(scaleFactor);
  return {
    x: rect.x / scale,
    y: rect.y / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** Native pixel size of a display (what to request from desktopCapturer). */
export function displayPixelSize(display: DisplayGeometry): Size {
  const scale = positiveScale(display.scaleFactor);
  return {
    width: Math.round(display.bounds.width * scale),
    height: Math.round(display.bounds.height * scale),
  };
}

/**
 * Pixels per DIP on each axis. The real ratio between the captured image and the display bounds
 * is used (fractional scale factors such as 125 % / 175 % round the bounds, so the nominal factor
 * can be off by a pixel); the nominal factor is the fallback when either size is unknown.
 */
function axisScales(display: DisplayGeometry, imageSize: Size): { sx: number; sy: number } {
  const nominal = positiveScale(display.scaleFactor);
  const { width, height } = display.bounds;
  return {
    sx: imageSize.width > 0 && width > 0 ? imageSize.width / width : nominal,
    sy: imageSize.height > 0 && height > 0 ? imageSize.height / height : nominal,
  };
}

/** Maps a DIP point of the display onto the captured image, clamped to the image. */
export function displayPointToImagePoint(
  point: Point,
  display: DisplayGeometry,
  imageSize: Size,
): Point {
  const { sx, sy } = axisScales(display, imageSize);
  return {
    x: clamp((point.x - display.bounds.x) * sx, 0, Math.max(0, imageSize.width)),
    y: clamp((point.y - display.bounds.y) * sy, 0, Math.max(0, imageSize.height)),
  };
}

/** Inverse of displayPointToImagePoint (no clamping). */
export function imagePointToDisplayPoint(
  point: Point,
  display: DisplayGeometry,
  imageSize: Size,
): Point {
  const { sx, sy } = axisScales(display, imageSize);
  return { x: display.bounds.x + point.x / sx, y: display.bounds.y + point.y / sy };
}

/** Maps an image-pixel rect (e.g. an OCR word box) back to DIPs, e.g. to highlight it in the overlay. */
export function imageRectToDisplayRect(
  rect: Rect,
  display: DisplayGeometry,
  imageSize: Size,
): Rect {
  const { sx, sy } = axisScales(display, imageSize);
  return {
    x: display.bounds.x + rect.x / sx,
    y: display.bounds.y + rect.y / sy,
    width: rect.width / sx,
    height: rect.height / sy,
  };
}

function fitAxis(start: number, end: number, minSize: number, limit: number): [number, number] {
  const wanted = Math.min(minSize, limit);
  if (end - start >= wanted) return [start, end];
  const from = clamp(Math.round((start + end) / 2 - wanted / 2), 0, limit - wanted);
  return [from, from + wanted];
}

/**
 * Crop rectangle (integer image pixels) for a selection made in DIPs on `display`: it covers every
 * pixel the selection touches, is clamped to the image and grown around its centre to at least
 * `minSize` pixels. A selection outside the display collapses onto the nearest edge first.
 */
export function cropRectFromSelection(
  selectionDip: Rect,
  display: DisplayGeometry,
  imageSize: Size,
  minSize = 8,
): Rect {
  const imageWidth = Math.max(0, Math.floor(imageSize.width));
  const imageHeight = Math.max(0, Math.floor(imageSize.height));
  const selection = normalizeRect(selectionDip);
  const numbers = [selection.x, selection.y, selection.width, selection.height];
  if (imageWidth === 0 || imageHeight === 0 || !numbers.every(Number.isFinite)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const { sx, sy } = axisScales(display, { width: imageWidth, height: imageHeight });
  const minimum = Number.isFinite(minSize) ? Math.max(0, Math.ceil(minSize)) : 0;
  const left = (selection.x - display.bounds.x) * sx;
  const top = (selection.y - display.bounds.y) * sy;
  const right = left + selection.width * sx;
  const bottom = top + selection.height * sy;
  const x0 = Math.floor(clamp(left, 0, imageWidth) + EPSILON);
  const y0 = Math.floor(clamp(top, 0, imageHeight) + EPSILON);
  const x1 = Math.ceil(clamp(right, 0, imageWidth) - EPSILON);
  const y1 = Math.ceil(clamp(bottom, 0, imageHeight) - EPSILON);
  const [fromX, toX] = fitAxis(x0, Math.max(x0, x1), minimum, imageWidth);
  const [fromY, toY] = fitAxis(y0, Math.max(y0, y1), minimum, imageHeight);
  return { x: fromX, y: fromY, width: toX - fromX, height: toY - fromY };
}

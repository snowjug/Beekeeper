/** Pure geometry of pinned screenshots: initial size, zoom anchoring and keeping a pin on screen. */
import { shiftRectInside, type Point, type Rect, type Size } from '@shared/geometry';
import { pickDisplay, type DisplayLike } from '../windows/placement';

export const MIN_PIN_SCALE = 0.1;
export const MAX_PIN_SCALE = 8;
/** Smallest window side in DIPs: a pin smaller than this could not be seen or grabbed. */
export const MIN_PIN_SIDE = 48;
/** Largest window side in DIPs (GPU textures stop at 16384 device pixels). */
export const MAX_PIN_SIDE = 12_000;
/** A new pin is at most this fraction of the display's work area, and never enlarged. */
export const INITIAL_PIN_FRACTION = 0.4;
/** How much of a pin must stay inside a display so it can always be found and dragged back. */
export const MIN_VISIBLE_DIP = 48;
/** Offset between pins that open one after another. */
export const CASCADE_STEP_DIP = 28;
const CASCADE_STEPS = 8;

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Window size in DIPs of an image shown at `scale` (1 = one image pixel per screen pixel). */
export function pinWindowSize(image: Size, scale: number, scaleFactor: number): Size {
  const factor = positive(scaleFactor);
  return {
    width: Math.max(1, Math.round((image.width * scale) / factor)),
    height: Math.max(1, Math.round((image.height * scale) / factor)),
  };
}

/** Keeps the zoom between 10 % and 800 %, and the window between 48 DIPs and 12000 DIPs. */
export function clampPinScale(scale: number, image: Size, scaleFactor: number): number {
  const factor = positive(scaleFactor);
  const shortest = Math.max(1, Math.min(image.width, image.height));
  const longest = Math.max(1, Math.max(image.width, image.height));
  const floor = Math.min(1, Math.max(MIN_PIN_SCALE, (MIN_PIN_SIDE * factor) / shortest));
  const ceiling = Math.max(floor, Math.min(MAX_PIN_SCALE, (MAX_PIN_SIDE * factor) / longest));
  return clamp(Number.isFinite(scale) ? scale : 1, floor, ceiling);
}

/** Zoom of a new pin: the whole image, at most 40 % of the display, never above 100 %. */
export function initialPinScale(image: Size, display: DisplayLike): number {
  const factor = positive(display.scaleFactor);
  const fit = Math.min(
    1,
    (display.workArea.width * INITIAL_PIN_FRACTION * factor) / Math.max(1, image.width),
    (display.workArea.height * INITIAL_PIN_FRACTION * factor) / Math.max(1, image.height),
  );
  return clampPinScale(fit, image, factor);
}

/**
 * Bounds of the window after zooming to `next`, keeping the point `anchor` (window DIPs; the centre
 * by default) under the same spot of the screen, so the pin grows around the cursor.
 */
export function zoomedBounds(current: Rect, next: Size, anchor?: Point): Rect {
  const width = Math.max(1, current.width);
  const height = Math.max(1, current.height);
  const at = {
    x: clamp(anchor?.x ?? width / 2, 0, width),
    y: clamp(anchor?.y ?? height / 2, 0, height),
  };
  return {
    x: Math.round(current.x + at.x - (at.x / width) * next.width),
    y: Math.round(current.y + at.y - (at.y / height) * next.height),
    width: next.width,
    height: next.height,
  };
}

/** Moves a window that drifted off every display back until at least `MIN_VISIBLE_DIP` shows. */
export function clampBoundsToDisplays(
  bounds: Rect,
  displays: readonly DisplayLike[],
  minVisible = MIN_VISIBLE_DIP,
): Rect {
  if (displays.length === 0) return bounds;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const area = pickDisplay(displays, center).workArea;
  const visibleX = Math.min(minVisible, bounds.width);
  const visibleY = Math.min(minVisible, bounds.height);
  return {
    ...bounds,
    x: Math.round(
      clamp(bounds.x, area.x - bounds.width + visibleX, area.x + area.width - visibleX),
    ),
    y: Math.round(
      clamp(bounds.y, area.y - bounds.height + visibleY, area.y + area.height - visibleY),
    ),
  };
}

/** Bounds of the window when its top-left corner is dragged to `target`; the size follows the display it lands on. */
export function movedBounds(
  current: Size,
  target: Point,
  image: Size,
  scale: number,
  displays: readonly DisplayLike[],
): Rect {
  if (displays.length === 0)
    return { x: Math.round(target.x), y: Math.round(target.y), ...current };
  const center = { x: target.x + current.width / 2, y: target.y + current.height / 2 };
  const display = pickDisplay(displays, center);
  const size = pinWindowSize(image, scale, display.scaleFactor);
  return clampBoundsToDisplays({ x: target.x, y: target.y, ...size }, displays);
}

/** Where the n-th pin opens: centred on the display, each next one a little down and right. */
export function cascadedBounds(size: Size, display: DisplayLike, index: number): Rect {
  const step = (Math.max(0, index) % CASCADE_STEPS) * CASCADE_STEP_DIP;
  const area = display.workArea;
  return shiftRectInside(
    {
      x: area.x + (area.width - size.width) / 2 + step,
      y: area.y + (area.height - size.height) / 2 + step,
      width: size.width,
      height: size.height,
    },
    {
      x: area.x,
      y: area.y,
      width: Math.max(area.width, size.width),
      height: Math.max(area.height, size.height),
    },
  );
}

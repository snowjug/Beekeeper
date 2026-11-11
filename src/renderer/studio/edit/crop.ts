/** Crop rectangle maths: handles, dragging with optional aspect ratio, presets, rule-of-thirds guides. */
import { rectContainsPoint, type Point, type Rect, type Size } from '@shared/geometry';

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
export type AspectPreset = 'free' | '1:1' | '16:9' | '4:3';

export const ASPECT_PRESETS: readonly AspectPreset[] = ['free', '1:1', '16:9', '4:3'];

/** The smallest crop in image pixels (smaller than the image itself only when the image is smaller). */
export const MIN_CROP_SIZE = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** width / height of a preset, or null for a free crop. */
export function aspectValue(preset: AspectPreset): number | null {
  switch (preset) {
    case '1:1':
      return 1;
    case '16:9':
      return 16 / 9;
    case '4:3':
      return 4 / 3;
    case 'free':
      return null;
  }
}

export function fullCrop(size: Size): Rect {
  return { x: 0, y: 0, width: size.width, height: size.height };
}

/** True when the crop keeps the whole image (so nothing needs to be cut). */
export function isFullCrop(crop: Rect | null, size: Size): boolean {
  return (
    crop === null ||
    (crop.x === 0 && crop.y === 0 && crop.width === size.width && crop.height === size.height)
  );
}

/** A whole-pixel rectangle inside the image that is not smaller than the minimum. */
export function clampCrop(rect: Rect, bounds: Size): Rect {
  const width = clamp(
    Math.round(rect.width),
    Math.min(MIN_CROP_SIZE, bounds.width),
    Math.max(1, bounds.width),
  );
  const height = clamp(
    Math.round(rect.height),
    Math.min(MIN_CROP_SIZE, bounds.height),
    Math.max(1, bounds.height),
  );
  return {
    x: clamp(Math.round(rect.x), 0, Math.max(0, bounds.width - width)),
    y: clamp(Math.round(rect.y), 0, Math.max(0, bounds.height - height)),
    width,
    height,
  };
}

/** Which handle of the crop rectangle is under `point` (corners first, then edges, then the inside). */
export function hitCropHandle(crop: Rect, point: Point, tolerance: number): CropHandle | null {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  const nearLeft = Math.abs(point.x - crop.x) <= tolerance;
  const nearRight = Math.abs(point.x - right) <= tolerance;
  const nearTop = Math.abs(point.y - crop.y) <= tolerance;
  const nearBottom = Math.abs(point.y - bottom) <= tolerance;
  const withinX = point.x >= crop.x - tolerance && point.x <= right + tolerance;
  const withinY = point.y >= crop.y - tolerance && point.y <= bottom + tolerance;

  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearLeft) return 'sw';
  if (nearBottom && nearRight) return 'se';
  if (nearTop && withinX) return 'n';
  if (nearBottom && withinX) return 's';
  if (nearLeft && withinY) return 'w';
  if (nearRight && withinY) return 'e';
  return rectContainsPoint(crop, point) ? 'move' : null;
}

/** The largest rectangle with the given ratio that fits inside `crop`, centred in it. */
export function fitAspect(crop: Rect, aspect: number | null, bounds: Size): Rect {
  if (aspect === null) return crop;
  let width = crop.width;
  let height = crop.height;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  return clampCrop(
    {
      x: crop.x + (crop.width - width) / 2,
      y: crop.y + (crop.height - height) / 2,
      width,
      height,
    },
    bounds,
  );
}

/** The crop after dragging `handle` by `delta` (image pixels) from the `start` rectangle. */
export function dragCrop(
  start: Rect,
  handle: CropHandle,
  delta: Point,
  bounds: Size,
  aspect: number | null,
): Rect {
  if (handle === 'move') {
    return {
      ...start,
      x: Math.round(clamp(start.x + delta.x, 0, Math.max(0, bounds.width - start.width))),
      y: Math.round(clamp(start.y + delta.y, 0, Math.max(0, bounds.height - start.height))),
    };
  }

  const minWidth = Math.min(MIN_CROP_SIZE, bounds.width);
  const minHeight = Math.min(MIN_CROP_SIZE, bounds.height);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (west) left = clamp(left + delta.x, 0, right - minWidth);
  if (east) right = clamp(right + delta.x, left + minWidth, bounds.width);
  if (north) top = clamp(top + delta.y, 0, bottom - minHeight);
  if (south) bottom = clamp(bottom + delta.y, top + minHeight, bounds.height);

  if (aspect === null) {
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  }

  let width = right - left;
  let height = bottom - top;
  const horizontal = west || east;
  const vertical = north || south;
  if (horizontal && vertical) {
    // A corner follows whichever side the pointer moved further relative to its size.
    if (Math.abs(width / start.width - 1) >= Math.abs(height / start.height - 1)) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
  } else if (horizontal) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }

  const centerX = start.x + start.width / 2;
  const centerY = start.y + start.height / 2;
  const roomX = horizontal
    ? east
      ? bounds.width - start.x
      : start.x + start.width
    : 2 * Math.min(centerX, bounds.width - centerX);
  const roomY = vertical
    ? south
      ? bounds.height - start.y
      : start.y + start.height
    : 2 * Math.min(centerY, bounds.height - centerY);
  const fit = Math.min(1, roomX / width, roomY / height);
  width *= fit;
  height *= fit;
  if (width < minWidth || height < minHeight) return start;

  return {
    x: Math.round(west ? start.x + start.width - width : east ? start.x : centerX - width / 2),
    y: Math.round(north ? start.y + start.height - height : south ? start.y : centerY - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Positions of the rule-of-thirds guide lines inside the crop (x of the verticals, y of the horizontals). */
export function thirdsGuides(crop: Rect): {
  vertical: [number, number];
  horizontal: [number, number];
} {
  return {
    vertical: [crop.x + crop.width / 3, crop.x + (crop.width * 2) / 3],
    horizontal: [crop.y + crop.height / 3, crop.y + (crop.height * 2) / 3],
  };
}

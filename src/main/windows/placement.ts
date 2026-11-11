import {
  ASSISTANT_BAR_WIDTH,
  ASSISTANT_BOTTOM_MARGIN,
  ASSISTANT_MAX_HEIGHT,
  ASSISTANT_WINDOW_PADDING,
} from '@shared/windows';
import type { Rect } from '@shared/ipc/types';

export interface DisplayLike {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

export interface PointLike {
  x: number;
  y: number;
}

function contains(rect: Rect, point: PointLike): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function distanceToRect(rect: Rect, point: PointLike): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** The display under the cursor, or the closest one (cursor can sit between monitors). */
export function pickDisplay<T extends DisplayLike>(displays: readonly T[], cursor: PointLike): T {
  const direct = displays.find((display) => contains(display.bounds, cursor));
  if (direct) return direct;
  const [first, ...rest] = displays;
  if (!first) throw new Error('No displays available');
  return rest.reduce(
    (best, display) =>
      distanceToRect(display.bounds, cursor) < distanceToRect(best.bounds, cursor) ? display : best,
    first,
  );
}

/**
 * Window rectangle (DIPs) for the assistant bar: horizontally centred on the display's work area,
 * resting just above the taskbar. The window is taller than the visible card and transparent, so
 * cards can grow upwards with spring animations without resizing the native window.
 */
export function computeAssistantBounds(display: DisplayLike): Rect {
  const { workArea } = display;
  const width = ASSISTANT_BAR_WIDTH + ASSISTANT_WINDOW_PADDING * 2;
  const available = workArea.height - ASSISTANT_BOTTOM_MARGIN;
  const height = Math.max(
    240,
    Math.min(ASSISTANT_MAX_HEIGHT + ASSISTANT_WINDOW_PADDING * 2, available),
  );
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const bottom = workArea.y + workArea.height - ASSISTANT_BOTTOM_MARGIN + ASSISTANT_WINDOW_PADDING;
  const clampedBottom = Math.min(bottom, display.bounds.y + display.bounds.height);
  return { x, y: Math.round(clampedBottom - height), width, height };
}

export function computeCenteredBounds(
  display: DisplayLike,
  size: { width: number; height: number },
): Rect {
  const { workArea } = display;
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

/** Photo assist "Hide sensitive info": the boxes the user reviews before anything is blurred. */
import { clampRect, type Size } from '@shared/geometry';
import type { Rect } from '@shared/geometry';
import type { SensitiveRegion } from '@shared/ipc/types';
import type { BlurOp } from './types';

export interface RedactionBox {
  id: string;
  /** Image pixels. */
  rect: Rect;
  kind: SensitiveRegion['kind'];
  label: string;
  /** Inactive boxes stay visible (dashed) but are not blurred. */
  active: boolean;
}

/** One box per region, all selected, kept inside the image. */
export function boxesFromRegions(
  regions: readonly SensitiveRegion[],
  bounds: Size,
): RedactionBox[] {
  const image: Rect = { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return regions
    .map((region, index) => ({
      id: `box-${index}`,
      rect: clampRect(region.rect, image),
      kind: region.kind,
      label: region.label,
      active: true,
    }))
    .filter((box) => box.rect.width > 0 && box.rect.height > 0);
}

export function toggleBox(boxes: readonly RedactionBox[], id: string): RedactionBox[] {
  return boxes.map((box) => (box.id === id ? { ...box, active: !box.active } : box));
}

export function removeBox(boxes: readonly RedactionBox[], id: string): RedactionBox[] {
  return boxes.filter((box) => box.id !== id);
}

export function activeBoxes(boxes: readonly RedactionBox[]): RedactionBox[] {
  return boxes.filter((box) => box.active);
}

/** Pixelate operations for the selected boxes; ids start at `firstId`. */
export function redactionOps(boxes: readonly RedactionBox[], firstId: number): BlurOp[] {
  return activeBoxes(boxes).map((box, index) => ({
    id: firstId + index,
    kind: 'blur',
    rect: box.rect,
    mode: 'pixelate',
  }));
}

import type { Size } from '@shared/geometry';

export interface Viewport {
  width: number;
  height: number;
}

export interface FitOptions {
  /** Share of the window width the picture may take. Default 0.78. */
  maxWidthRatio?: number;
  /** Share of the window height the picture may take. Default 0.72. */
  maxHeightRatio?: number;
  /** Room (CSS pixels) kept free above and below, for the pills and the toolbar. */
  reserveTop?: number;
  reserveBottom?: number;
  /** Device pixels per CSS pixel of the display: a native image is shown at its real size, never larger. */
  scaleFactor?: number;
}

export interface FittedSize {
  /** CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per image pixel. */
  scale: number;
}

/**
 * The size the picture is shown at: as large as fits in 78 % of the window width and 72 % of its
 * height (less when the toolbars need the room), never enlarged beyond its native size.
 */
export function fitImage(image: Size, viewport: Viewport, options: FitOptions = {}): FittedSize {
  const factor = options.scaleFactor && options.scaleFactor > 0 ? options.scaleFactor : 1;
  const nativeWidth = Math.max(1, image.width) / factor;
  const nativeHeight = Math.max(1, image.height) / factor;
  const maxWidth = Math.max(1, viewport.width * (options.maxWidthRatio ?? 0.78));
  const maxHeight = Math.max(
    1,
    Math.min(
      viewport.height * (options.maxHeightRatio ?? 0.72),
      viewport.height - (options.reserveTop ?? 0) - (options.reserveBottom ?? 0),
    ),
  );
  const shown = Math.min(1, maxWidth / nativeWidth, maxHeight / nativeHeight);
  return {
    width: Math.max(1, Math.floor(nativeWidth * shown)),
    height: Math.max(1, Math.floor(nativeHeight * shown)),
    scale: (shown * nativeWidth) / Math.max(1, image.width),
  };
}

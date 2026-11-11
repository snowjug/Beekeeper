import { desktopCapturer, nativeImage, screen, type Display, type NativeImage } from 'electron';
import type { Logger } from '@shared/logger';
import { createScreenGrabber, type ScreenGrabber } from './gdi';

export interface ScreenCapture {
  image: NativeImage;
  /** Native pixel size of the captured image. */
  width: number;
  height: number;
  display: Display;
  scaleFactor: number;
}

/** Physical pixel size of a display (Electron reports bounds in device independent pixels). */
export function nativeSize(display: Display): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
  };
}

let grabber: Promise<ScreenGrabber | null> | undefined;

/** Loads the GDI grabber once. Resolves to null when it cannot be used on this machine. */
export function loadScreenGrabber(logger?: Logger): Promise<ScreenGrabber | null> {
  grabber ??= createScreenGrabber().catch((error: unknown) => {
    logger?.warn('Fast screen capture is unavailable; using the slower desktopCapturer.', error);
    return null;
  });
  return grabber;
}

async function captureWithGdi(display: Display, logger?: Logger): Promise<ScreenCapture | null> {
  const fast = await loadScreenGrabber(logger);
  if (!fast) return null;
  try {
    // Display bounds are in DIPs; GDI addresses the virtual desktop in physical pixels.
    const frame = fast.grab(screen.dipToScreenRect(null, display.bounds));
    const image = nativeImage.createFromBitmap(frame.bitmap, {
      width: frame.width,
      height: frame.height,
    });
    if (image.isEmpty()) return null;
    return {
      image,
      width: frame.width,
      height: frame.height,
      display,
      scaleFactor: display.scaleFactor,
    };
  } catch (error) {
    logger?.warn('GDI screen capture failed; using the slower desktopCapturer.', error);
    return null;
  }
}

/**
 * Sources are matched to displays by `display_id`; if Windows does not report ids, the n-th screen
 * source is matched to the n-th display. Takes 1.7-3.4 s, so it is only the fallback.
 */
async function captureWithDesktopCapturer(
  display: Display,
  allDisplays: readonly Display[],
): Promise<ScreenCapture> {
  const size = nativeSize(display);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: size,
    fetchWindowIcons: false,
  });

  const byId = sources.find((source) => source.display_id === String(display.id));
  const index = allDisplays.findIndex((candidate) => candidate.id === display.id);
  const source = byId ?? sources[index] ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Windows did not return a screenshot of this display.');
  }

  const image = source.thumbnail;
  const actual = image.getSize();
  return {
    image,
    width: actual.width,
    height: actual.height,
    display,
    scaleFactor: display.scaleFactor,
  };
}

/**
 * Captures one display at its native resolution (DPI aware: 100/125/150/200 % scaling and
 * multi-monitor layouts). GDI is the fast path (tens of milliseconds); Electron's desktopCapturer
 * is the fallback if GDI cannot be loaded or refuses to copy the screen.
 */
export async function captureDisplay(
  display: Display,
  allDisplays: readonly Display[],
  logger?: Logger,
): Promise<ScreenCapture> {
  return (
    (await captureWithGdi(display, logger)) ??
    (await captureWithDesktopCapturer(display, allDisplays))
  );
}

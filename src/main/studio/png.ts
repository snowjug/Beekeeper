/** Cheap validation of PNG bytes: the Studio never decodes an image it has not checked first. */
import type { Size } from '@shared/geometry';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Zero-length IEND chunk: every complete PNG ends with these 12 bytes. */
const TRAILER = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;
const IHDR_OFFSET = 8;
const HEADER_LENGTH = 33;

/** Longest side and largest area (pixels) of an image the Studio accepts (8K is 33 million). */
export const MAX_IMAGE_SIDE = 20_000;
export const MAX_IMAGE_PIXELS = 100_000_000;

function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/**
 * Pixel size of a complete PNG, read from its header. Null when the bytes are not a PNG, are cut
 * short, or the image is bigger than the Studio is willing to hold in memory.
 */
export function readPngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < HEADER_LENGTH + TRAILER.length) return null;
  if (!matches(bytes, 0, SIGNATURE)) return null;
  if (
    uint32(bytes, IHDR_OFFSET) !== 13 ||
    !matches(bytes, IHDR_OFFSET + 4, [0x49, 0x48, 0x44, 0x52])
  ) {
    return null;
  }
  if (!matches(bytes, bytes.length - TRAILER.length, TRAILER)) return null;
  const width = uint32(bytes, IHDR_OFFSET + 8);
  const height = uint32(bytes, IHDR_OFFSET + 12);
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return null;
  if (width * height > MAX_IMAGE_PIXELS) return null;
  return { width, height };
}

import {
  cropRectFromSelection,
  expandRect,
  normalizeRect,
  rectContainsPoint,
  rectIntersection,
  type Point,
  type Rect,
  type Size,
} from '@shared/geometry';
import type { OcrLineDto, OcrResultDto, OcrWordDto } from '@shared/ipc/types';
import type { OcrResult } from '../capture/ocr';

/** Window-relative DIP geometry of the overlay (it covers one display). */
export interface OverlayGeometry {
  /** Overlay size in DIPs (= display bounds size). */
  bounds: Size;
  /** Native pixel size of the frozen screenshot. */
  image: Size;
}

/** Image pixels covered by a selection drawn in overlay DIPs (integer, clamped, never empty). */
export function selectionToCrop(selectionDip: Rect, geometry: OverlayGeometry): Rect {
  const display = {
    bounds: { x: 0, y: 0, width: geometry.bounds.width, height: geometry.bounds.height },
    scaleFactor: 1,
  };
  return cropRectFromSelection(selectionDip, display, geometry.image);
}

/** Pixels per DIP on each axis (real ratio, robust against fractional display scaling). */
export function pixelsPerDip(geometry: OverlayGeometry): { x: number; y: number } {
  return {
    x: geometry.bounds.width > 0 ? geometry.image.width / geometry.bounds.width : 1,
    y: geometry.bounds.height > 0 ? geometry.image.height / geometry.bounds.height : 1,
  };
}

/**
 * OCR of a crop is run on an upscaled copy when the text would otherwise be tiny: Tesseract needs
 * glyphs of about 20+ px height. Bigger crops are left alone to keep recognition fast.
 */
export function ocrUpscaleFactor(crop: Size, scaleFactor: number): number {
  const pixels = crop.width * crop.height;
  if (scaleFactor >= 1.75 || pixels > 2_000_000) return 1;
  return pixels > 700_000 ? 1.5 : 2;
}

function toDip(rect: Rect, crop: Rect, factor: number, geometry: OverlayGeometry): Rect {
  const scale = pixelsPerDip(geometry);
  return {
    x: (crop.x + rect.x / factor) / scale.x,
    y: (crop.y + rect.y / factor) / scale.y,
    width: rect.width / factor / scale.x,
    height: rect.height / factor / scale.y,
  };
}

/**
 * Converts an OCR result computed on `crop` (possibly upscaled by `factor`) into overlay DIPs, so
 * the renderer can place highlights directly. Confidences are mapped from 0-100 to 0-1.
 */
export function ocrResultToDip(
  result: OcrResult,
  crop: Rect,
  factor: number,
  geometry: OverlayGeometry,
): OcrResultDto {
  const word = (source: { text: string; confidence: number; bbox: Rect }): OcrWordDto => ({
    text: source.text,
    confidence: source.confidence / 100,
    bbox: toDip(source.bbox, crop, factor, geometry),
  });
  const lines: OcrLineDto[] = result.lines.map((line) => ({
    text: line.text,
    confidence: line.confidence / 100,
    bbox: toDip(line.bbox, crop, factor, geometry),
    words: line.words.map(word),
  }));
  return {
    text: result.text,
    confidence: result.confidence / 100,
    lines,
    words: result.words.map(word),
    durationMs: result.durationMs,
  };
}

const TAP_BAND_HALF_WIDTH = 340;
const TAP_BAND_HALF_HEIGHT = 70;

/** Region OCR'd around a tap: a wide, short band so one line (and its neighbours) is read quickly. */
export function tapBand(point: Point, bounds: Size): Rect {
  const band = normalizeRect({
    x: point.x - TAP_BAND_HALF_WIDTH,
    y: point.y - TAP_BAND_HALF_HEIGHT,
    width: TAP_BAND_HALF_WIDTH * 2,
    height: TAP_BAND_HALF_HEIGHT * 2,
  });
  const screen = { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return rectIntersection(band, screen) ?? screen;
}

export interface TapHit {
  /** The word under (or nearest to) the pointer, in overlay DIPs. */
  word: OcrWordDto;
  line: OcrLineDto;
}

const TAP_SLOP = 10;

/** Finds the recognised word under the pointer; falls back to the nearest word within a small slop. */
export function pickTapTarget(result: OcrResultDto, point: Point): TapHit | null {
  let best: { hit: TapHit; distance: number } | null = null;
  for (const line of result.lines) {
    for (const word of line.words) {
      if (word.text.trim() === '') continue;
      let distance = 0;
      if (!rectContainsPoint(word.bbox, point)) {
        if (!rectContainsPoint(expandRect(word.bbox, TAP_SLOP), point)) continue;
        const center = {
          x: word.bbox.x + word.bbox.width / 2,
          y: word.bbox.y + word.bbox.height / 2,
        };
        distance = Math.hypot(center.x - point.x, center.y - point.y) + 1;
      }
      if (!best || distance < best.distance) best = { hit: { word, line }, distance };
    }
  }
  return best?.hit ?? null;
}

/** Selection rectangle (overlay DIPs) for a tap: the word, or the whole line for a double tap. */
export function tapSelection(hit: TapHit, whole: 'word' | 'line', bounds: Size): Rect {
  const source = whole === 'line' ? hit.line.bbox : hit.word.bbox;
  const padded = expandRect(source, 6);
  const screen = { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return rectIntersection(padded, screen) ?? padded;
}

/** Recognition result describing just the tapped word, or its whole line for a double tap. */
export function tapResult(hit: TapHit, whole: 'word' | 'line'): OcrResultDto {
  if (whole === 'line') {
    return {
      text: hit.line.text.trim(),
      confidence: hit.line.confidence,
      lines: [hit.line],
      words: hit.line.words,
      durationMs: 0,
    };
  }
  const { word } = hit;
  return {
    text: word.text.trim(),
    confidence: word.confidence,
    lines: [{ text: word.text, confidence: word.confidence, bbox: word.bbox, words: [word] }],
    words: [word],
    durationMs: 0,
  };
}

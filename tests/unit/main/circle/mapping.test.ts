import { describe, expect, it } from 'vitest';
import type { OcrResult } from '@main/capture/ocr';
import {
  ocrResultToDip,
  ocrUpscaleFactor,
  pickTapTarget,
  pixelsPerDip,
  selectionToCrop,
  tapBand,
  tapResult,
  tapSelection,
} from '@main/circle/mapping';

// A 1280x720 DIP display captured at 150 % (1920x1080 pixels).
const GEOMETRY = { bounds: { width: 1280, height: 720 }, image: { width: 1920, height: 1080 } };

describe('selection to image pixels', () => {
  it('maps DIPs to physical pixels at 150 % scaling', () => {
    expect(selectionToCrop({ x: 100, y: 40, width: 200, height: 80 }, GEOMETRY)).toEqual({
      x: 150,
      y: 60,
      width: 300,
      height: 120,
    });
    expect(pixelsPerDip(GEOMETRY)).toEqual({ x: 1.5, y: 1.5 });
  });

  it('clamps selections that leave the screen', () => {
    const crop = selectionToCrop({ x: 1200, y: 700, width: 400, height: 400 }, GEOMETRY);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1920);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1080);
    expect(crop.width).toBeGreaterThan(0);
  });

  it('copes with a fractional scale factor (125 %: 1600x900 on a 1280x720 display)', () => {
    const geometry = { bounds: { width: 1280, height: 720 }, image: { width: 1600, height: 900 } };
    expect(selectionToCrop({ x: 640, y: 360, width: 128, height: 72 }, geometry)).toEqual({
      x: 800,
      y: 450,
      width: 160,
      height: 90,
    });
  });
});

describe('ocrUpscaleFactor', () => {
  it('upscales small crops on low-DPI screens only', () => {
    expect(ocrUpscaleFactor({ width: 400, height: 100 }, 1)).toBe(2);
    expect(ocrUpscaleFactor({ width: 1000, height: 800 }, 1)).toBe(1.5);
    expect(ocrUpscaleFactor({ width: 2000, height: 1200 }, 1)).toBe(1);
    expect(ocrUpscaleFactor({ width: 400, height: 100 }, 2)).toBe(1);
  });
});

function result(): OcrResult {
  const words = [
    { text: 'Hello', confidence: 90, bbox: { x: 10, y: 20, width: 100, height: 40 }, lineIndex: 0 },
    {
      text: 'world',
      confidence: 80,
      bbox: { x: 130, y: 20, width: 110, height: 40 },
      lineIndex: 0,
    },
  ];
  return {
    text: 'Hello world',
    confidence: 85,
    durationMs: 12,
    words,
    lines: [
      {
        text: 'Hello world',
        confidence: 85,
        bbox: { x: 10, y: 20, width: 230, height: 40 },
        words,
      },
    ],
  };
}

describe('ocrResultToDip', () => {
  it('maps boxes of an upscaled crop back to overlay DIPs', () => {
    const crop = { x: 150, y: 60, width: 300, height: 120 };
    const dip = ocrResultToDip(result(), crop, 2, GEOMETRY);
    // word box in the 2x crop (10,20) -> crop px (5,10) -> image px (155,70) -> DIP (103.33, 46.67)
    const first = dip.words[0];
    expect(first?.bbox.x).toBeCloseTo(103.33, 1);
    expect(first?.bbox.y).toBeCloseTo(46.67, 1);
    expect(first?.bbox.width).toBeCloseTo(33.33, 1);
    expect(first?.confidence).toBeCloseTo(0.9);
    expect(dip.text).toBe('Hello world');
    expect(dip.lines[0]?.words).toHaveLength(2);
  });
});

describe('tap targeting', () => {
  const dip = ocrResultToDip(result(), { x: 0, y: 0, width: 300, height: 100 }, 1, {
    bounds: { width: 300, height: 100 },
    image: { width: 300, height: 100 },
  });

  it('builds a short, wide band around the tap and keeps it on screen', () => {
    const band = tapBand({ x: 20, y: 30 }, { width: 1280, height: 720 });
    expect(band.x).toBe(0);
    expect(band.y).toBe(0);
    expect(band.width).toBeLessThanOrEqual(680);
    expect(band.height).toBeLessThanOrEqual(140);
  });

  it('picks the word under the pointer, or the nearest one within the slop', () => {
    expect(pickTapTarget(dip, { x: 50, y: 40 })?.word.text).toBe('Hello');
    expect(pickTapTarget(dip, { x: 180, y: 40 })?.word.text).toBe('world');
    expect(pickTapTarget(dip, { x: 117, y: 40 })?.word.text).toBe('Hello');
    expect(pickTapTarget(dip, { x: 280, y: 90 })).toBeNull();
  });

  it('selects the word, or the whole line for a double tap', () => {
    const hit = pickTapTarget(dip, { x: 50, y: 40 });
    if (!hit) throw new Error('expected a hit');
    const bounds = { width: 300, height: 100 };
    const word = tapSelection(hit, 'word', bounds);
    const line = tapSelection(hit, 'line', bounds);
    expect(line.width).toBeGreaterThan(word.width);
    expect(tapResult(hit, 'word').text).toBe('Hello');
    expect(tapResult(hit, 'line').text).toBe('Hello world');
    expect(tapResult(hit, 'line').words).toHaveLength(2);
  });
});

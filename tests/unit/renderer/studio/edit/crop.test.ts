import { describe, expect, it } from 'vitest';
import {
  aspectValue,
  clampCrop,
  dragCrop,
  fitAspect,
  fullCrop,
  hitCropHandle,
  isFullCrop,
  MIN_CROP_SIZE,
  thirdsGuides,
} from '@renderer/studio/edit/crop';

const IMAGE = { width: 1000, height: 600 };
const CROP = { x: 200, y: 100, width: 400, height: 300 };

describe('aspect presets', () => {
  it('knows the ratio of every preset', () => {
    expect(aspectValue('free')).toBeNull();
    expect(aspectValue('1:1')).toBe(1);
    expect(aspectValue('16:9')).toBeCloseTo(1.7778, 3);
    expect(aspectValue('4:3')).toBeCloseTo(1.3333, 3);
  });

  it('fits the largest rectangle of a ratio inside the crop, centred', () => {
    expect(fitAspect(CROP, 1, IMAGE)).toEqual({ x: 250, y: 100, width: 300, height: 300 });
    expect(fitAspect(CROP, 16 / 9, IMAGE)).toEqual({ x: 200, y: 138, width: 400, height: 225 });
    expect(fitAspect(CROP, null, IMAGE)).toBe(CROP);
  });

  it('fits a tall crop by its width', () => {
    expect(fitAspect({ x: 0, y: 0, width: 200, height: 600 }, 1, IMAGE)).toEqual({
      x: 0,
      y: 200,
      width: 200,
      height: 200,
    });
  });
});

describe('clampCrop', () => {
  it('rounds to whole pixels and keeps the crop inside the image', () => {
    expect(clampCrop({ x: -20.4, y: 10.6, width: 300.2, height: 200.7 }, IMAGE)).toEqual({
      x: 0,
      y: 11,
      width: 300,
      height: 201,
    });
    expect(clampCrop({ x: 900, y: 500, width: 400, height: 400 }, IMAGE)).toEqual({
      x: 600,
      y: 200,
      width: 400,
      height: 400,
    });
  });

  it('never makes a crop smaller than the minimum, or larger than the image', () => {
    expect(clampCrop({ x: 10, y: 10, width: 2, height: 2 }, IMAGE)).toMatchObject({
      width: MIN_CROP_SIZE,
      height: MIN_CROP_SIZE,
    });
    expect(clampCrop({ x: 0, y: 0, width: 5000, height: 5000 }, IMAGE)).toEqual(fullCrop(IMAGE));
  });

  it('allows the whole of an image that is smaller than the minimum', () => {
    expect(clampCrop({ x: 0, y: 0, width: 4, height: 4 }, { width: 8, height: 8 })).toMatchObject({
      width: 8,
      height: 8,
    });
  });
});

describe('isFullCrop', () => {
  it('is true for no crop and for a crop of the whole image', () => {
    expect(isFullCrop(null, IMAGE)).toBe(true);
    expect(isFullCrop(fullCrop(IMAGE), IMAGE)).toBe(true);
    expect(isFullCrop({ x: 1, y: 0, width: 999, height: 600 }, IMAGE)).toBe(false);
  });
});

describe('hitCropHandle', () => {
  const tolerance = 10;

  it.each([
    [{ x: 200, y: 100 }, 'nw'],
    [{ x: 600, y: 100 }, 'ne'],
    [{ x: 200, y: 400 }, 'sw'],
    [{ x: 600, y: 400 }, 'se'],
    [{ x: 400, y: 100 }, 'n'],
    [{ x: 400, y: 400 }, 's'],
    [{ x: 200, y: 250 }, 'w'],
    [{ x: 600, y: 250 }, 'e'],
    [{ x: 400, y: 250 }, 'move'],
    [{ x: 195, y: 105 }, 'nw'],
  ] as const)('finds %j -> %s', (point, handle) => {
    expect(hitCropHandle(CROP, point, tolerance)).toBe(handle);
  });

  it.each([
    { x: 100, y: 250 },
    { x: 700, y: 250 },
    { x: 400, y: 50 },
    { x: 400, y: 450 },
  ])('finds nothing at %j', (point) => {
    expect(hitCropHandle(CROP, point, tolerance)).toBeNull();
  });
});

describe('dragCrop', () => {
  it('moves the crop and keeps it inside the image', () => {
    expect(dragCrop(CROP, 'move', { x: 50, y: -30 }, IMAGE, null)).toEqual({
      ...CROP,
      x: 250,
      y: 70,
    });
    expect(dragCrop(CROP, 'move', { x: 9999, y: 9999 }, IMAGE, null)).toEqual({
      ...CROP,
      x: 600,
      y: 300,
    });
    expect(dragCrop(CROP, 'move', { x: -9999, y: -9999 }, IMAGE, null)).toEqual({
      ...CROP,
      x: 0,
      y: 0,
    });
  });

  it('drags one edge and leaves the opposite edge where it is', () => {
    expect(dragCrop(CROP, 'e', { x: 100, y: 77 }, IMAGE, null)).toEqual({ ...CROP, width: 500 });
    expect(dragCrop(CROP, 'w', { x: 50, y: 0 }, IMAGE, null)).toEqual({
      ...CROP,
      x: 250,
      width: 350,
    });
    expect(dragCrop(CROP, 'n', { x: 0, y: -40 }, IMAGE, null)).toEqual({
      ...CROP,
      y: 60,
      height: 340,
    });
    expect(dragCrop(CROP, 's', { x: 0, y: 40 }, IMAGE, null)).toEqual({ ...CROP, height: 340 });
  });

  it('drags a corner in both directions', () => {
    expect(dragCrop(CROP, 'se', { x: 100, y: 50 }, IMAGE, null)).toEqual({
      ...CROP,
      width: 500,
      height: 350,
    });
    expect(dragCrop(CROP, 'nw', { x: -50, y: -50 }, IMAGE, null)).toEqual({
      x: 150,
      y: 50,
      width: 450,
      height: 350,
    });
  });

  it('stops at the image edge and at the smallest size', () => {
    expect(dragCrop(CROP, 'e', { x: 9999, y: 0 }, IMAGE, null).width).toBe(800);
    expect(dragCrop(CROP, 'w', { x: -9999, y: 0 }, IMAGE, null)).toMatchObject({
      x: 0,
      width: 600,
    });
    expect(dragCrop(CROP, 'e', { x: -9999, y: 0 }, IMAGE, null).width).toBe(MIN_CROP_SIZE);
    expect(dragCrop(CROP, 's', { x: 0, y: -9999 }, IMAGE, null).height).toBe(MIN_CROP_SIZE);
  });

  it('keeps the ratio when dragging a corner', () => {
    const square = { x: 200, y: 100, width: 300, height: 300 };
    const wider = dragCrop(square, 'se', { x: 60, y: 10 }, IMAGE, 1);
    expect(wider).toEqual({ x: 200, y: 100, width: 360, height: 360 });
    const taller = dragCrop(square, 'se', { x: 5, y: 80 }, IMAGE, 1);
    expect(taller).toEqual({ x: 200, y: 100, width: 380, height: 380 });
    const fromTopLeft = dragCrop(square, 'nw', { x: -40, y: 0 }, IMAGE, 1);
    expect(fromTopLeft).toEqual({ x: 160, y: 60, width: 340, height: 340 });
  });

  it('keeps the ratio when dragging an edge, growing around the middle of the other side', () => {
    const square = { x: 300, y: 200, width: 200, height: 200 };
    expect(dragCrop(square, 'e', { x: 100, y: 0 }, IMAGE, 1)).toEqual({
      x: 300,
      y: 150,
      width: 300,
      height: 300,
    });
    expect(dragCrop(square, 's', { x: 0, y: 60 }, IMAGE, 1)).toEqual({
      x: 270,
      y: 200,
      width: 260,
      height: 260,
    });
  });

  it('shrinks a ratio crop that would leave the image', () => {
    const result = dragCrop(
      { x: 600, y: 300, width: 300, height: 300 },
      'se',
      { x: 500, y: 500 },
      IMAGE,
      1,
    );
    expect(result.x + result.width).toBeLessThanOrEqual(IMAGE.width);
    expect(result.y + result.height).toBeLessThanOrEqual(IMAGE.height);
    expect(result.width).toBe(result.height);
  });

  it('keeps the crop it had when the ratio would make it too small', () => {
    const start = { x: 0, y: 0, width: 600, height: 10 };
    expect(dragCrop(start, 'e', { x: -590, y: 0 }, IMAGE, 1)).toEqual(start);
  });
});

describe('thirdsGuides', () => {
  it('splits the crop into nine equal parts', () => {
    expect(thirdsGuides({ x: 30, y: 60, width: 300, height: 90 })).toEqual({
      vertical: [130, 230],
      horizontal: [90, 120],
    });
  });
});

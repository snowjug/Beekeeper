import { describe, expect, it } from 'vitest';
import {
  cascadedBounds,
  clampBoundsToDisplays,
  clampPinScale,
  initialPinScale,
  MAX_PIN_SCALE,
  MAX_PIN_SIDE,
  MIN_PIN_SCALE,
  MIN_PIN_SIDE,
  movedBounds,
  pinWindowSize,
  zoomedBounds,
} from '@main/studio/pinMath';
import { buildPinMenu } from '@main/studio/pinMenu';
import type { DisplayLike } from '@main/windows/placement';

const PRIMARY: DisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
const SECOND: DisplayLike = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1280, height: 720 },
  workArea: { x: 1920, y: 0, width: 1280, height: 680 },
  scaleFactor: 1.5,
};

describe('pinWindowSize', () => {
  it('shows one image pixel per screen pixel at 100 %', () => {
    expect(pinWindowSize({ width: 1920, height: 1080 }, 1, 1)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(pinWindowSize({ width: 1920, height: 1080 }, 1, 1.5)).toEqual({
      width: 1280,
      height: 720,
    });
    expect(pinWindowSize({ width: 1920, height: 1080 }, 0.5, 2)).toEqual({
      width: 480,
      height: 270,
    });
  });

  it('never gives an empty window and survives a nonsense scale factor', () => {
    expect(pinWindowSize({ width: 1, height: 1 }, 0.1, 4)).toEqual({ width: 1, height: 1 });
    expect(pinWindowSize({ width: 100, height: 50 }, 1, 0)).toEqual({ width: 100, height: 50 });
  });
});

describe('clampPinScale', () => {
  const full = { width: 1920, height: 1080 };

  it('keeps the zoom between 10 % and 800 %', () => {
    expect(clampPinScale(0.01, full, 1)).toBe(MIN_PIN_SCALE);
    expect(clampPinScale(1, full, 1)).toBe(1);
    expect(clampPinScale(100, { width: 100, height: 60 }, 1)).toBe(MAX_PIN_SCALE);
  });

  it('keeps a small image from shrinking below a window that can be grabbed', () => {
    const icon = { width: 100, height: 100 };
    expect(clampPinScale(0.1, icon, 1)).toBeCloseTo(MIN_PIN_SIDE / 100);
    // An image smaller than the minimum cannot shrink at all.
    expect(clampPinScale(0.1, { width: 20, height: 20 }, 1)).toBe(1);
  });

  it('keeps a huge zoom from growing the window beyond what the GPU can draw', () => {
    const wide = { width: 4000, height: 2000 };
    expect(clampPinScale(8, wide, 1)).toBeCloseTo(MAX_PIN_SIDE / 4000);
    expect(pinWindowSize(wide, clampPinScale(8, wide, 1), 1).width).toBeLessThanOrEqual(
      MAX_PIN_SIDE,
    );
  });

  it('answers 100 % for a value that is not a number', () => {
    expect(clampPinScale(Number.NaN, full, 1)).toBe(1);
  });
});

describe('initialPinScale', () => {
  it('fits a large screenshot into 40 % of the display', () => {
    const scale = initialPinScale({ width: 1920, height: 1080 }, PRIMARY);
    // The 1040 DIP high work area is the limit: 40 % of it is 416 DIPs.
    expect(scale).toBeCloseTo(416 / 1080);
    const size = pinWindowSize({ width: 1920, height: 1080 }, scale, 1);
    expect(size).toEqual({ width: 740, height: 416 });
    expect(size.width).toBeLessThanOrEqual(PRIMARY.workArea.width * 0.4);
    expect(size.height).toBeLessThanOrEqual(PRIMARY.workArea.height * 0.4);
  });

  it('is limited by the taller side of a portrait image', () => {
    expect(initialPinScale({ width: 600, height: 2400 }, PRIMARY)).toBeCloseTo((1040 * 0.4) / 2400);
  });

  it('never enlarges a small image', () => {
    expect(initialPinScale({ width: 300, height: 200 }, PRIMARY)).toBe(1);
  });

  it('counts physical pixels on a scaled display', () => {
    const scale = initialPinScale({ width: 3840, height: 2160 }, { ...PRIMARY, scaleFactor: 2 });
    expect(scale).toBeCloseTo((1040 * 0.4 * 2) / 2160);
    expect(pinWindowSize({ width: 3840, height: 2160 }, scale, 2)).toEqual({
      width: 740,
      height: 416,
    });
  });
});

describe('zoomedBounds', () => {
  const current = { x: 100, y: 100, width: 400, height: 200 };

  it('keeps the point under the cursor in place while the pin grows', () => {
    const next = { width: 800, height: 400 };
    const bounds = zoomedBounds(current, next, { x: 100, y: 50 });
    // The cursor is 25 % across and 25 % down: it must stay at the same screen position.
    expect(bounds.x + (100 / 400) * bounds.width).toBeCloseTo(100 + 100);
    expect(bounds.y + (50 / 200) * bounds.height).toBeCloseTo(100 + 50);
    expect(bounds).toMatchObject({ width: 800, height: 400, x: 0, y: 50 });
  });

  it('zooms around the centre without an anchor', () => {
    expect(zoomedBounds(current, { width: 200, height: 100 })).toEqual({
      x: 200,
      y: 150,
      width: 200,
      height: 100,
    });
  });

  it('treats an anchor outside the window as its nearest edge', () => {
    expect(zoomedBounds(current, { width: 200, height: 100 }, { x: -50, y: -50 })).toMatchObject({
      x: 100,
      y: 100,
    });
    expect(zoomedBounds(current, { width: 200, height: 100 }, { x: 9999, y: 9999 })).toMatchObject({
      x: 300,
      y: 200,
    });
  });
});

describe('clampBoundsToDisplays', () => {
  const displays = [PRIMARY, SECOND];

  it('leaves a window that is on screen alone', () => {
    const bounds = { x: 300, y: 200, width: 640, height: 360 };
    expect(clampBoundsToDisplays(bounds, displays)).toEqual(bounds);
  });

  it('brings a window that drifted off to the right back until 48 px show', () => {
    const bounds = clampBoundsToDisplays({ x: 5000, y: 100, width: 640, height: 360 }, displays);
    expect(bounds.x).toBe(SECOND.workArea.x + SECOND.workArea.width - 48);
  });

  it('keeps the top and left edges reachable too', () => {
    const bounds = clampBoundsToDisplays({ x: -2000, y: -2000, width: 640, height: 360 }, [
      PRIMARY,
    ]);
    expect(bounds.x).toBe(-640 + 48);
    expect(bounds.y).toBe(-360 + 48);
  });

  it('keeps the bottom edge above the taskbar', () => {
    const bounds = clampBoundsToDisplays({ x: 100, y: 5000, width: 640, height: 360 }, [PRIMARY]);
    expect(bounds.y).toBe(1040 - 48);
  });

  it('uses the display the window mostly sits on', () => {
    const bounds = { x: 2600, y: 900, width: 400, height: 300 };
    expect(clampBoundsToDisplays(bounds, displays).y).toBe(680 - 48);
  });

  it('keeps a tiny window fully visible and does nothing without displays', () => {
    expect(clampBoundsToDisplays({ x: 9000, y: 0, width: 30, height: 30 }, [PRIMARY]).x).toBe(
      1920 - 30,
    );
    const bounds = { x: 9, y: 9, width: 9, height: 9 };
    expect(clampBoundsToDisplays(bounds, [])).toBe(bounds);
  });
});

describe('movedBounds', () => {
  const image = { width: 1920, height: 1080 };

  it('moves the window to the dragged position', () => {
    expect(
      movedBounds({ width: 768, height: 432 }, { x: 200.4, y: 120 }, image, 0.4, [PRIMARY]),
    ).toEqual({
      x: 200,
      y: 120,
      width: 768,
      height: 432,
    });
  });

  it('takes the size of the display the window lands on, so the pin keeps its physical size', () => {
    const moved = movedBounds({ width: 768, height: 432 }, { x: 2200, y: 100 }, image, 0.4, [
      PRIMARY,
      SECOND,
    ]);
    expect(moved.width).toBe(512);
    expect(moved.height).toBe(288);
  });

  it('keeps part of the window on screen', () => {
    const moved = movedBounds({ width: 768, height: 432 }, { x: 99999, y: 0 }, image, 0.4, [
      PRIMARY,
    ]);
    expect(moved.x).toBe(1920 - 48);
  });

  it('works without any display information', () => {
    expect(movedBounds({ width: 10, height: 20 }, { x: 5.6, y: 7 }, image, 1, [])).toEqual({
      x: 6,
      y: 7,
      width: 10,
      height: 20,
    });
  });
});

describe('cascadedBounds', () => {
  const size = { width: 600, height: 400 };

  it('centres the first pin on the work area', () => {
    expect(cascadedBounds(size, PRIMARY, 0)).toEqual({ x: 660, y: 320, width: 600, height: 400 });
  });

  it('offsets every next pin by 28 px and wraps after eight', () => {
    expect(cascadedBounds(size, PRIMARY, 1)).toMatchObject({ x: 688, y: 348 });
    expect(cascadedBounds(size, PRIMARY, 3)).toMatchObject({ x: 744, y: 404 });
    expect(cascadedBounds(size, PRIMARY, 8)).toEqual(cascadedBounds(size, PRIMARY, 0));
  });

  it('keeps a pin inside the work area and puts one that is too large at its corner', () => {
    expect(cascadedBounds({ width: 1900, height: 1000 }, PRIMARY, 7)).toMatchObject({
      x: 20,
      y: 40,
    });
    expect(cascadedBounds({ width: 3000, height: 2000 }, PRIMARY, 2)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('buildPinMenu', () => {
  const info = {
    id: 'pin',
    imageUrl: 'u',
    width: 100,
    height: 100,
    scale: 0.5,
    opacity: 0.75,
    clickThrough: true,
  };

  function actions() {
    const calls: string[] = [];
    return {
      calls,
      handlers: {
        copy: () => calls.push('copy'),
        save: () => calls.push('save'),
        setOpacity: (value: number) => calls.push(`opacity ${value}`),
        setScale: (value: number) => calls.push(`scale ${value}`),
        toggleClickThrough: () => calls.push('click-through'),
        close: () => calls.push('close'),
        closeAll: () => calls.push('close all'),
      },
    };
  }

  it('lists copy, save, opacity, size, click-through and close', () => {
    const { handlers } = actions();
    const items = buildPinMenu(info, handlers, 1);
    expect(items.map((item) => item.label ?? '---')).toEqual([
      'Copy image',
      'Save image',
      '---',
      'Opacity',
      'Size (50%)',
      'Let clicks pass through',
      '---',
      'Close pin',
    ]);
  });

  it('marks the current opacity, size and click-through state', () => {
    const { handlers } = actions();
    const items = buildPinMenu(info, handlers, 1);
    const opacity = items.find((item) => item.label === 'Opacity')?.submenu ?? [];
    expect(opacity.filter((item) => item.checked).map((item) => item.label)).toEqual(['75%']);
    const size = items.find((item) => item.label?.startsWith('Size'))?.submenu ?? [];
    expect(size.filter((item) => item.checked).map((item) => item.label)).toEqual(['50%']);
    expect(items.find((item) => item.type === 'checkbox')?.checked).toBe(true);
  });

  it('wires every entry to its action', () => {
    const { handlers, calls } = actions();
    const items = buildPinMenu(info, handlers, 3);
    const flat = items.flatMap((item) => (item.submenu ? item.submenu : [item]));
    for (const item of flat) item.click?.();
    expect(calls).toEqual([
      'copy',
      'save',
      'opacity 1',
      'opacity 0.75',
      'opacity 0.5',
      'opacity 0.25',
      'scale 0.25',
      'scale 0.5',
      'scale 1',
      'scale 2',
      'click-through',
      'close',
      'close all',
    ]);
    expect(items.at(-1)?.label).toBe('Close all 3 pins');
  });
});

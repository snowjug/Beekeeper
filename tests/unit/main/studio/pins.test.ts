import { describe, expect, it, vi } from 'vitest';
import { CaptureStore } from '@main/capture/store';
import { PinManager } from '@main/studio/pins';
import {
  createFakePinWindows,
  createFakePlatform,
  createLogger,
  DISPLAY,
  makePng,
} from './support';

const SIZE = { width: 1920, height: 1080 };
const SECOND_DISPLAY = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1280, height: 720 },
  workArea: { x: 1920, y: 0, width: 1280, height: 680 },
  scaleFactor: 1.5,
};

function setup() {
  const windows = createFakePinWindows();
  const platform = createFakePlatform();
  const captures = new CaptureStore();
  const saveImage = vi.fn((_png: Buffer) => Promise.resolve('C:\\Shots\\pin.png'));
  let counter = 0;
  const manager = new PinManager({
    windows,
    captures,
    platform,
    saveImage,
    newId: () => `pin-${(counter += 1)}`,
    logger: createLogger(),
  });
  return { windows, platform, captures, saveImage, manager };
}

function createPin(
  harness: ReturnType<typeof setup>,
  png = makePng(1920, 1080),
  size: { width: number; height: number } = SIZE,
) {
  const info = harness.manager.create(png, size, DISPLAY);
  const window = harness.windows.windows.at(-1);
  if (!window) throw new Error('no window was created');
  return { info, window, png };
}

describe('creating a pin', () => {
  it('opens a window sized to at most 40 % of the display, centred, with the pin id in its page address', () => {
    const harness = setup();
    const { info, window } = createPin(harness);
    expect(info).toEqual({
      id: 'pin-1',
      imageUrl: 'beekeeper://app/capture/pin-1.png',
      width: 1920,
      height: 1080,
      scale: expect.closeTo(416 / 1080, 5) as number,
      opacity: 1,
      clickThrough: false,
    });
    expect(window.bounds).toEqual({ x: 590, y: 312, width: 740, height: 416 });
    expect(window.query).toBe('id=pin-1');
  });

  it('keeps the image in the capture store until the pin is closed', () => {
    const harness = setup();
    const { png, window } = createPin(harness);
    expect(harness.captures.get('pin-1')).toEqual({ data: png, mime: 'image/png' });
    window.close();
    expect(harness.captures.get('pin-1')).toBeUndefined();
    expect(harness.manager.count).toBe(0);
  });

  it('opens several pins at once, each a little offset from the last', () => {
    const harness = setup();
    createPin(harness);
    createPin(harness);
    createPin(harness);
    const [first, second, third] = harness.windows.windows;
    expect(harness.manager.count).toBe(3);
    expect(second?.bounds.x).toBe((first?.bounds.x ?? 0) + 28);
    expect(third?.bounds.y).toBe((first?.bounds.y ?? 0) + 56);
  });

  it('frees the stored image when the window cannot be created', () => {
    const harness = setup();
    const failing = {
      create: () => {
        throw new Error('no window');
      },
    };
    const manager = new PinManager({
      windows: failing,
      captures: harness.captures,
      platform: harness.platform,
      saveImage: harness.saveImage,
      newId: () => 'pin-x',
      logger: createLogger(),
    });
    expect(() => manager.create(makePng(), { width: 4, height: 3 }, DISPLAY)).toThrow('no window');
    expect(harness.captures.get('pin-x')).toBeUndefined();
    expect(manager.count).toBe(0);
  });
});

describe('identifying pins', () => {
  it('answers pin:getInfo for the window that asks, and for no other', () => {
    const harness = setup();
    const { window } = createPin(harness);
    expect(harness.manager.info(window.webContentsId)?.id).toBe('pin-1');
    expect(harness.manager.info(999)).toBeNull();
  });

  it('ignores actions from windows that are not pins', async () => {
    const harness = setup();
    await expect(harness.manager.act(999, { type: 'close' })).resolves.toBeUndefined();
    expect(harness.manager.count).toBe(0);
  });
});

describe('zoom', () => {
  it('resizes the window around the anchor and publishes the new zoom', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    const before = window.bounds;
    await harness.manager.act(window.webContentsId, {
      type: 'scale',
      value: 0.8,
      anchor: { x: 0, y: 0 },
    });
    expect(window.bounds).toEqual({ x: before.x, y: before.y, width: 1536, height: 864 });
    expect(window.updates.at(-1)?.scale).toBeCloseTo(0.8);
  });

  it('zooms around the centre when no anchor is given', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    const center = {
      x: window.bounds.x + window.bounds.width / 2,
      y: window.bounds.y + window.bounds.height / 2,
    };
    await harness.manager.act(window.webContentsId, { type: 'scale', value: 0.2 });
    expect(window.bounds.x + window.bounds.width / 2).toBeCloseTo(center.x, 0);
    expect(window.bounds.y + window.bounds.height / 2).toBeCloseTo(center.y, 0);
  });

  it('keeps the zoom between 10 % and 800 %', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'scale', value: 0.01 });
    expect(harness.manager.info(window.webContentsId)?.scale).toBe(0.1);

    const small = createPin(harness, makePng(100, 60), { width: 100, height: 60 }).window;
    await harness.manager.act(small.webContentsId, { type: 'scale', value: 100 });
    expect(harness.manager.info(small.webContentsId)?.scale).toBe(8);
    expect(small.bounds).toMatchObject({ width: 800, height: 480 });
  });

  it('goes back to 100 % with resetScale', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'resetScale' });
    expect(window.bounds).toMatchObject({ width: 1920, height: 1080 });
    expect(harness.manager.info(window.webContentsId)?.scale).toBe(1);
  });

  it('sizes the pin for the display it is on', async () => {
    const harness = setup();
    harness.platform.displayList = [DISPLAY, SECOND_DISPLAY];
    const { window } = createPin(harness);
    window.setBounds({ x: 2100, y: 100, width: 500, height: 300 });
    await harness.manager.act(window.webContentsId, { type: 'resetScale' });
    expect(window.bounds).toMatchObject({ width: 1280, height: 720 });
  });
});

describe('opacity and click-through', () => {
  it('sets the window opacity, never below 10 %', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'opacity', value: 0.5 });
    expect(window.opacity).toBe(0.5);
    expect(window.updates.at(-1)?.opacity).toBe(0.5);
    await harness.manager.act(window.webContentsId, { type: 'opacity', value: 0.01 });
    expect(window.opacity).toBe(0.1);
  });

  it('lets mouse events pass through and tells the page', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'clickThrough', value: true });
    expect(window.clickThrough).toBe(true);
    expect(window.updates.at(-1)?.clickThrough).toBe(true);
    await harness.manager.act(window.webContentsId, { type: 'clickThrough', value: false });
    expect(window.clickThrough).toBe(false);
  });

  it('catches clicks again while the pointer is over the unlock control', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'clickThrough', value: true });
    await harness.manager.act(window.webContentsId, { type: 'interactive', value: true });
    expect(window.clickThrough).toBe(false);
    await harness.manager.act(window.webContentsId, { type: 'interactive', value: false });
    expect(window.clickThrough).toBe(true);
  });

  it('ignores the unlock control when click-through is off', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'interactive', value: false });
    expect(window.clickThrough).toBe(false);
  });
});

describe('moving', () => {
  it('moves the window where the page dragged it, clamped to the screen', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'move', x: 100, y: 50 });
    expect(window.bounds).toMatchObject({ x: 100, y: 50 });
    await harness.manager.act(window.webContentsId, { type: 'move', x: 99999, y: 50 });
    expect(window.bounds.x).toBe(1920 - 48);
  });
});

describe('copy and save', () => {
  it('copies the pinned image to the clipboard', async () => {
    const harness = setup();
    const { window, png } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'copy' });
    expect(harness.platform.writeClipboardImage).toHaveBeenCalledWith(png);
  });

  it('saves the image and tells the user where; the notification reveals the file', async () => {
    const harness = setup();
    const { window, png } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'save' });
    expect(harness.saveImage).toHaveBeenCalledWith(png);
    expect(harness.platform.notices[0]).toMatchObject({ body: 'C:\\Shots\\pin.png' });
    harness.platform.notices[0]?.onClick?.();
    expect(harness.platform.revealInFolder).toHaveBeenCalledWith('C:\\Shots\\pin.png');
  });

  it('lets the page see that saving failed', async () => {
    const harness = setup();
    harness.saveImage.mockRejectedValueOnce(new Error('disk full'));
    const { window } = createPin(harness);
    await expect(harness.manager.act(window.webContentsId, { type: 'save' })).rejects.toThrow(
      'disk full',
    );
  });
});

describe('closing', () => {
  it('closes a pin on request and forgets it', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'close' });
    expect(window.closed).toBe(true);
    expect(harness.manager.count).toBe(0);
    expect(harness.manager.info(window.webContentsId)).toBeNull();
  });

  it('closes every pin, leaving the other pins alone when one closes', async () => {
    const harness = setup();
    const first = createPin(harness).window;
    const second = createPin(harness).window;
    createPin(harness);
    await harness.manager.act(first.webContentsId, { type: 'close' });
    expect(harness.manager.count).toBe(2);
    expect(second.closed).toBe(false);
    harness.manager.closeAll();
    expect(harness.windows.windows.every((window) => window.closed)).toBe(true);
    expect(harness.manager.count).toBe(0);
    expect(harness.captures.size).toBe(0);
  });
});

describe('context menu', () => {
  it('opens a native menu whose entries act on this pin', async () => {
    const harness = setup();
    const { window, png } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'menu' });
    const items = window.menus[0] ?? [];
    expect(items.map((item) => item.label)).toContain('Copy image');

    items.find((item) => item.label === 'Copy image')?.click?.();
    await vi.waitFor(() => expect(harness.platform.writeClipboardImage).toHaveBeenCalledWith(png));
    items.find((item) => item.label === 'Save image')?.click?.();
    await vi.waitFor(() => expect(harness.saveImage).toHaveBeenCalled());

    const opacity = items.find((item) => item.label === 'Opacity')?.submenu ?? [];
    opacity.find((item) => item.label === '50%')?.click?.();
    expect(window.opacity).toBe(0.5);

    const size = items.find((item) => item.label?.startsWith('Size'))?.submenu ?? [];
    size.find((item) => item.label === 'Actual size (100%)')?.click?.();
    expect(window.bounds).toMatchObject({ width: 1920, height: 1080 });

    items.find((item) => item.type === 'checkbox')?.click?.();
    expect(window.clickThrough).toBe(true);

    items.find((item) => item.label === 'Close pin')?.click?.();
    expect(window.closed).toBe(true);
  });

  it('offers to close all pins when there are several', async () => {
    const harness = setup();
    const { window } = createPin(harness);
    createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'menu' });
    const items = window.menus[0] ?? [];
    items.find((item) => item.label?.startsWith('Close all'))?.click?.();
    expect(harness.manager.count).toBe(0);
  });

  it('logs, but does not throw, when a menu action fails', async () => {
    const harness = setup();
    harness.platform.writeClipboardImage.mockRejectedValueOnce(new Error('clipboard busy'));
    const { window } = createPin(harness);
    await harness.manager.act(window.webContentsId, { type: 'menu' });
    window.menus[0]?.find((item) => item.label === 'Copy image')?.click?.();
    await vi.waitFor(() => expect(harness.platform.writeClipboardImage).toHaveBeenCalled());
  });
});

describe('display changes', () => {
  it('watches the displays only while pins exist', () => {
    const harness = setup();
    expect(harness.platform.listenerCount()).toBe(0);
    const { window } = createPin(harness);
    createPin(harness);
    expect(harness.platform.listenerCount()).toBe(1);
    window.close();
    expect(harness.platform.listenerCount()).toBe(1);
    harness.manager.closeAll();
    expect(harness.platform.listenerCount()).toBe(0);
  });

  it('brings a pin back on screen when its monitor goes away', () => {
    const harness = setup();
    harness.platform.displayList = [DISPLAY, SECOND_DISPLAY];
    const { window } = createPin(harness);
    window.setBounds({ x: 2400, y: 100, width: 500, height: 300 });
    harness.platform.displayList = [DISPLAY];
    harness.platform.emitDisplayChange();
    expect(window.bounds.x).toBeLessThanOrEqual(1920 - 48);
  });
});

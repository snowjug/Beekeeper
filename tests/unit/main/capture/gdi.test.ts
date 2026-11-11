import { describe, expect, it, vi } from 'vitest';
import {
  createGdi,
  createScreenGrabber,
  grabScreen,
  makeOpaque,
  type BitmapInfoHeader,
  type Gdi,
  type Handle,
  type KoffiModule,
} from '../../../../src/main/capture/gdi';

const SCREEN_DC = { name: 'screen-dc' };
const MEMORY_DC = { name: 'memory-dc' };
const BITMAP = { name: 'bitmap' };
const OLD_BITMAP = { name: 'default-bitmap' };

interface Fake {
  gdi: Gdi;
  calls: string[];
  bitBlt: ReturnType<typeof vi.fn<Gdi['bitBlt']>>;
  header: () => BitmapInfoHeader | undefined;
}

function fakeGdi(options: { bitBlt?: number; lines?: number; dc?: Handle } = {}): Fake {
  const calls: string[] = [];
  let header: BitmapInfoHeader | undefined;
  const bitBlt = vi.fn<Gdi['bitBlt']>(() => {
    calls.push('bitBlt');
    return options.bitBlt ?? 1;
  });
  const gdi: Gdi = {
    getDc: () => {
      calls.push('getDc');
      return options.dc === undefined ? SCREEN_DC : options.dc;
    },
    releaseDc: () => {
      calls.push('releaseDc');
      return 1;
    },
    createCompatibleDc: () => {
      calls.push('createCompatibleDc');
      return MEMORY_DC;
    },
    createCompatibleBitmap: () => {
      calls.push('createCompatibleBitmap');
      return BITMAP;
    },
    selectObject: (_dc, object) => {
      calls.push(object === BITMAP ? 'select(bitmap)' : 'select(previous)');
      return OLD_BITMAP;
    },
    bitBlt,
    getDiBits: (_dc, _bitmap, _first, lineCount, bits, info) => {
      calls.push('getDiBits');
      header = info;
      // Two pixels per row are enough to prove the buffer is the one that is returned.
      bits.fill(0x11);
      return options.lines ?? lineCount;
    },
    deleteObject: () => {
      calls.push('deleteObject');
      return 1;
    },
    deleteDc: () => {
      calls.push('deleteDc');
      return 1;
    },
  };
  return { gdi, calls, bitBlt, header: () => header };
}

describe('makeOpaque', () => {
  it('sets the alpha byte of every pixel and keeps the colours', () => {
    const pixels = Buffer.from([10, 20, 30, 0, 40, 50, 60, 0]);
    makeOpaque(pixels);
    expect([...pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('also works for a buffer that is not 4-byte aligned', () => {
    const backing = new ArrayBuffer(12);
    const pixels = Buffer.from(backing, 1, 8);
    pixels.set([1, 2, 3, 0, 4, 5, 6, 0]);
    makeOpaque(pixels);
    expect([...pixels]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
});

describe('grabScreen', () => {
  it('copies the rectangle (with layered windows) into an opaque top-down BGRA buffer', () => {
    const fake = fakeGdi();
    const frame = grabScreen(fake.gdi, { x: -1920, y: 40, width: 4, height: 2 });

    expect(frame.width).toBe(4);
    expect(frame.height).toBe(2);
    expect(frame.bitmap.length).toBe(4 * 2 * 4);
    // 0x11 colour bytes from GetDIBits, alpha forced to 255.
    expect([...frame.bitmap.subarray(0, 4)]).toEqual([0x11, 0x11, 0x11, 0xff]);

    const [, destX, destY, width, height, , sourceX, sourceY, rop] =
      fake.bitBlt.mock.calls[0] ?? [];
    expect([destX, destY, width, height, sourceX, sourceY]).toEqual([0, 0, 4, 2, -1920, 40]);
    // SRCCOPY | CAPTUREBLT
    expect(rop).toBe(0x40cc0020);
    expect(fake.header()).toMatchObject({ biWidth: 4, biHeight: -2, biBitCount: 32, biPlanes: 1 });
  });

  it('deselects the bitmap before reading it and releases every GDI object', () => {
    const fake = fakeGdi();
    grabScreen(fake.gdi, { x: 0, y: 0, width: 2, height: 2 });
    expect(fake.calls).toEqual([
      'getDc',
      'createCompatibleDc',
      'createCompatibleBitmap',
      'select(bitmap)',
      'bitBlt',
      'select(previous)',
      'getDiBits',
      'deleteObject',
      'deleteDc',
      'releaseDc',
    ]);
  });

  it('still cleans up when Windows refuses to copy the screen', () => {
    const fake = fakeGdi({ bitBlt: 0 });
    expect(() => grabScreen(fake.gdi, { x: 0, y: 0, width: 2, height: 2 })).toThrow(/BitBlt/);
    expect(fake.calls.slice(-4)).toEqual([
      'select(previous)',
      'deleteObject',
      'deleteDc',
      'releaseDc',
    ]);
  });

  it('fails when only some of the lines could be read', () => {
    const fake = fakeGdi({ lines: 1 });
    expect(() => grabScreen(fake.gdi, { x: 0, y: 0, width: 2, height: 2 })).toThrow(/1 of 2/);
    expect(fake.calls).toContain('releaseDc');
  });

  it('fails without a screen device context', () => {
    const fake = fakeGdi({ dc: null });
    expect(() => grabScreen(fake.gdi, { x: 0, y: 0, width: 2, height: 2 })).toThrow(/GetDC/);
    expect(fake.calls).toEqual(['getDc']);
  });

  it('rejects an empty area before touching GDI', () => {
    const fake = fakeGdi();
    expect(() => grabScreen(fake.gdi, { x: 0, y: 0, width: 0, height: 10 })).toThrow(RangeError);
    expect(fake.calls).toEqual([]);
  });
});

describe('createGdi / createScreenGrabber', () => {
  function fakeKoffi(): KoffiModule & { declared: string[] } {
    const declared: string[] = [];
    return {
      declared,
      struct: vi.fn(() => ({})),
      load: (library) => ({
        func: (definition) => {
          declared.push(`${library}:${definition.split('(')[0] ?? ''}`);
          return vi.fn();
        },
      }),
    };
  }

  it('binds the user32 and gdi32 functions that the capture needs', () => {
    const koffi = fakeKoffi();
    createGdi(koffi);
    expect(koffi.declared).toEqual([
      'user32.dll:void *GetDC',
      'user32.dll:int ReleaseDC',
      'gdi32.dll:void *CreateCompatibleDC',
      'gdi32.dll:void *CreateCompatibleBitmap',
      'gdi32.dll:void *SelectObject',
      'gdi32.dll:int BitBlt',
      'gdi32.dll:int GetDIBits',
      'gdi32.dll:int DeleteObject',
      'gdi32.dll:int DeleteDC',
    ]);
  });

  it('rejects when the native module cannot be loaded, so callers can fall back', async () => {
    const load = vi.fn(() => Promise.reject(new Error('koffi.node was blocked')));
    await expect(createScreenGrabber(load)).rejects.toThrow('blocked');
  });

  it('returns a grabber once the module is loaded', async () => {
    const grabber = await createScreenGrabber(() => Promise.resolve(fakeKoffi()));
    expect(typeof grabber.grab).toBe('function');
  });
});

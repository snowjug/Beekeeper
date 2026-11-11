/**
 * Fast screen capture through GDI (user32 / gdi32 called via koffi).
 *
 * Electron's desktopCapturer needs 1.7-3.4 s for a single full HD screenshot on the reference
 * machine (the time does not depend on the thumbnail size), far too slow for the "Circle to Search
 * opens in < 400 ms" budget. A GDI BitBlt of the same display takes 20-60 ms. DWM composition is
 * included (CAPTUREBLT), so layered and transparent windows appear as the user sees them.
 */

export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawFrame {
  width: number;
  height: number;
  /** Opaque, top-down BGRA pixels (the native bitmap order of Windows / Skia). */
  bitmap: Buffer;
}

export interface ScreenGrabber {
  /** Captures a rectangle in physical screen pixels (virtual desktop coordinates). */
  grab: (rect: PhysicalRect) => RawFrame;
}

/** Native handle (HDC, HBITMAP ...): an opaque koffi pointer object, or null. */
export type Handle = object | null;

export interface BitmapInfoHeader {
  biSize: number;
  biWidth: number;
  biHeight: number;
  biPlanes: number;
  biBitCount: number;
  biCompression: number;
  biSizeImage: number;
  biXPelsPerMeter: number;
  biYPelsPerMeter: number;
  biClrUsed: number;
  biClrImportant: number;
}

/** The handful of GDI functions that a screen capture needs. */
export interface Gdi {
  getDc: (window: Handle) => Handle;
  releaseDc: (window: Handle, dc: Handle) => number;
  createCompatibleDc: (dc: Handle) => Handle;
  createCompatibleBitmap: (dc: Handle, width: number, height: number) => Handle;
  selectObject: (dc: Handle, object: Handle) => Handle;
  bitBlt: (
    destination: Handle,
    x: number,
    y: number,
    width: number,
    height: number,
    source: Handle,
    sourceX: number,
    sourceY: number,
    rop: number,
  ) => number;
  getDiBits: (
    dc: Handle,
    bitmap: Handle,
    firstLine: number,
    lineCount: number,
    bits: Buffer,
    info: BitmapInfoHeader,
    usage: number,
  ) => number;
  deleteObject: (object: Handle) => number;
  deleteDc: (dc: Handle) => number;
}

/** The slice of the koffi API that is used (keeps the native module out of the type surface). */
export interface KoffiModule {
  load: (library: string) => { func: (definition: string) => unknown };
  struct: (name: string, members: Record<string, string>) => unknown;
}

const SRCCOPY = 0x00cc0020;
/** Also copies layered (transparent) windows. */
const CAPTUREBLT = 0x40000000;
const DIB_RGB_COLORS = 0;
const BI_RGB = 0;

/** Binds the GDI functions through koffi. */
export function createGdi(koffi: KoffiModule): Gdi {
  koffi.struct('BITMAPINFOHEADER', {
    biSize: 'uint32',
    biWidth: 'int32',
    biHeight: 'int32',
    biPlanes: 'uint16',
    biBitCount: 'uint16',
    biCompression: 'uint32',
    biSizeImage: 'uint32',
    biXPelsPerMeter: 'int32',
    biYPelsPerMeter: 'int32',
    biClrUsed: 'uint32',
    biClrImportant: 'uint32',
  });
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  return {
    getDc: user32.func('void *GetDC(void *hWnd)') as Gdi['getDc'],
    releaseDc: user32.func('int ReleaseDC(void *hWnd, void *hDC)') as Gdi['releaseDc'],
    createCompatibleDc: gdi32.func(
      'void *CreateCompatibleDC(void *hdc)',
    ) as Gdi['createCompatibleDc'],
    createCompatibleBitmap: gdi32.func(
      'void *CreateCompatibleBitmap(void *hdc, int cx, int cy)',
    ) as Gdi['createCompatibleBitmap'],
    selectObject: gdi32.func('void *SelectObject(void *hdc, void *h)') as Gdi['selectObject'],
    bitBlt: gdi32.func(
      'int BitBlt(void *hdc, int x, int y, int cx, int cy, void *hdcSrc, int x1, int y1, uint32 rop)',
    ) as Gdi['bitBlt'],
    getDiBits: gdi32.func(
      'int GetDIBits(void *hdc, void *hbm, uint32 start, uint32 cLines, void *lpvBits, _Inout_ BITMAPINFOHEADER *lpbmi, uint32 usage)',
    ) as Gdi['getDiBits'],
    deleteObject: gdi32.func('int DeleteObject(void *ho)') as Gdi['deleteObject'],
    deleteDc: gdi32.func('int DeleteDC(void *hdc)') as Gdi['deleteDc'],
  };
}

/** GDI leaves the alpha byte of a 32-bit bitmap at 0, which would make the image transparent. */
export function makeOpaque(pixels: Buffer): void {
  if (pixels.byteOffset % 4 === 0) {
    const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength >> 2);
    for (let i = 0; i < words.length; i++) words[i] = (words[i] ?? 0) | 0xff000000;
    return;
  }
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0xff;
}

function bitmapHeader(width: number, height: number): BitmapInfoHeader {
  return {
    biSize: 40,
    biWidth: width,
    // A negative height asks for top-down rows.
    biHeight: -height,
    biPlanes: 1,
    biBitCount: 32,
    biCompression: BI_RGB,
    biSizeImage: 0,
    biXPelsPerMeter: 0,
    biYPelsPerMeter: 0,
    biClrUsed: 0,
    biClrImportant: 0,
  };
}

/** Copies a screen rectangle into an opaque BGRA buffer. Every GDI object is released again. */
export function grabScreen(gdi: Gdi, rect: PhysicalRect): RawFrame {
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (!(width > 0 && height > 0)) throw new RangeError('The screen area to capture is empty.');

  const screenDc = gdi.getDc(null);
  if (!screenDc) throw new Error('Windows did not give access to the screen (GetDC failed).');
  let memoryDc: Handle = null;
  let bitmap: Handle = null;
  try {
    memoryDc = gdi.createCompatibleDc(screenDc);
    bitmap = gdi.createCompatibleBitmap(screenDc, width, height);
    if (!memoryDc || !bitmap) throw new Error('Could not allocate the screenshot bitmap.');

    const previous = gdi.selectObject(memoryDc, bitmap);
    try {
      const copied = gdi.bitBlt(
        memoryDc,
        0,
        0,
        width,
        height,
        screenDc,
        Math.round(rect.x),
        Math.round(rect.y),
        SRCCOPY | CAPTUREBLT,
      );
      if (!copied) throw new Error('Windows refused to copy the screen (BitBlt failed).');
    } finally {
      // GetDIBits needs the bitmap to be deselected.
      gdi.selectObject(memoryDc, previous);
    }

    const pixels = Buffer.allocUnsafeSlow(width * height * 4);
    const lines = gdi.getDiBits(
      memoryDc,
      bitmap,
      0,
      height,
      pixels,
      bitmapHeader(width, height),
      DIB_RGB_COLORS,
    );
    if (lines !== height) throw new Error(`GetDIBits returned ${lines} of ${height} lines.`);
    makeOpaque(pixels);
    return { width, height, bitmap: pixels };
  } finally {
    if (bitmap) gdi.deleteObject(bitmap);
    if (memoryDc) gdi.deleteDc(memoryDc);
    gdi.releaseDc(null, screenDc);
  }
}

async function loadKoffi(): Promise<KoffiModule> {
  const module = (await import('koffi')) as unknown as KoffiModule & { default?: KoffiModule };
  return module.default ?? module;
}

/** Loads koffi lazily so a missing or blocked native module never prevents the app from starting. */
export async function createScreenGrabber(
  load: () => Promise<KoffiModule> = loadKoffi,
): Promise<ScreenGrabber> {
  const gdi = createGdi(await load());
  return { grab: (rect) => grabScreen(gdi, rect) };
}

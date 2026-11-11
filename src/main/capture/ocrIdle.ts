import type { OcrService } from './ocr';

export interface IdleTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const nodeTimers: IdleTimers = {
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * Keeps the OCR worker alive only while Circle to Search is in use: the WebAssembly engine costs
 * tens of megabytes, so it is released after `idleMs` without a request (spec 7: idle RAM budget) and
 * the OcrService transparently starts a new worker on the next use.
 */
export function withIdleRelease(
  inner: OcrService,
  idleMs: number,
  timers: IdleTimers = nodeTimers,
): OcrService {
  let handle: unknown = null;
  const touch = (): void => {
    if (handle !== null) timers.clear(handle);
    handle = timers.set(() => {
      handle = null;
      void inner.dispose();
    }, idleMs);
  };
  return {
    warmUp() {
      touch();
      return inner.warmUp();
    },
    recognize(image, options) {
      touch();
      return inner.recognize(image, options);
    },
    dispose() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      return inner.dispose();
    },
  };
}

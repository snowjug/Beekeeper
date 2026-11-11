import { describe, expect, it, vi } from 'vitest';
import type { OcrResult, OcrService } from '@main/capture/ocr';
import { withIdleRelease, type IdleTimers } from '@main/capture/ocrIdle';

function fakeTimers() {
  const pending = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  const timers: IdleTimers = {
    set: (callback, ms) => {
      const id = next++;
      pending.set(id, { callback, ms });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    pending,
    fireAll: () => {
      for (const [id, timer] of [...pending]) {
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

function inner() {
  const warmUp = vi.fn(() => Promise.resolve());
  const recognize = vi.fn(() => Promise.resolve({ text: 'x' } as OcrResult));
  const dispose = vi.fn(() => Promise.resolve());
  const service: OcrService = { warmUp, recognize, dispose };
  return { service, warmUp, recognize, dispose };
}

describe('withIdleRelease', () => {
  it('releases the worker after the idle period and restarts the countdown on every use', async () => {
    const { timers, pending, fireAll } = fakeTimers();
    const { service, warmUp, recognize, dispose } = inner();
    const keeper = withIdleRelease(service, 60_000, timers);

    await keeper.warmUp();
    expect(warmUp).toHaveBeenCalledOnce();
    expect([...pending.values()][0]?.ms).toBe(60_000);

    await keeper.recognize(new Uint8Array(1), {});
    expect(recognize).toHaveBeenCalledOnce();
    expect(pending.size).toBe(1);

    fireAll();
    expect(dispose).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);

    // Using it again re-arms the release.
    await keeper.recognize(new Uint8Array(1));
    expect(pending.size).toBe(1);
  });

  it('dispose cancels the countdown and disposes the engine once', async () => {
    const { timers, pending } = fakeTimers();
    const { service, dispose } = inner();
    const keeper = withIdleRelease(service, 1000, timers);
    await keeper.warmUp();
    await keeper.dispose();
    expect(pending.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

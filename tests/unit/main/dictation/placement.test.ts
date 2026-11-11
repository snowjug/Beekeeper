import { describe, expect, it, vi } from 'vitest';
import { createEscapeKey, type ShortcutRegistry } from '@main/dictation/escapeKey';
import { computePillBounds } from '@main/dictation/placement';
import type { Logger } from '@shared/logger';

const SIZE = { width: 360, height: 84 };
const WORK = { x: 0, y: 0, width: 1280, height: 680 };

describe('computePillBounds', () => {
  it('centres the pill at the bottom of the work area without a caret', () => {
    expect(computePillBounds({ size: SIZE, work: WORK })).toEqual({
      x: 460,
      y: 568,
      width: 360,
      height: 84,
    });
  });

  it('follows the work area of a second display', () => {
    const second = { x: 1280, y: 0, width: 1920, height: 1040 };
    expect(computePillBounds({ size: SIZE, work: second, caret: null })).toEqual({
      x: 1280 + 780,
      y: 1040 - 84 - 28,
      width: 360,
      height: 84,
    });
  });

  it('puts the pill just below the caret, a little to its left', () => {
    const bounds = computePillBounds({
      size: SIZE,
      work: WORK,
      caret: { x: 400, y: 200, width: 2, height: 20 },
    });
    expect(bounds).toEqual({ x: 360, y: 200 + 20 + 14 - 10, width: 360, height: 84 });
  });

  it('keeps the pill inside the work area horizontally', () => {
    const left = computePillBounds({
      size: SIZE,
      work: WORK,
      caret: { x: 5, y: 100, width: 2, height: 20 },
    });
    expect(left.x).toBe(8);
    const right = computePillBounds({
      size: SIZE,
      work: WORK,
      caret: { x: 1270, y: 100, width: 2, height: 20 },
    });
    expect(right.x).toBe(1280 - 360 - 8);
  });

  it('moves above the caret when there is no room below it', () => {
    const bounds = computePillBounds({
      size: SIZE,
      work: WORK,
      caret: { x: 400, y: 640, width: 2, height: 20 },
    });
    expect(bounds.y).toBe(640 - 14 - 84 + 10);
  });

  it('falls back to the bottom centre when neither side fits', () => {
    const tiny = { x: 0, y: 0, width: 1280, height: 120 };
    const bounds = computePillBounds({
      size: SIZE,
      work: tiny,
      caret: { x: 400, y: 60, width: 2, height: 20 },
    });
    expect(bounds).toEqual(computePillBounds({ size: SIZE, work: tiny }));
  });

  it('copes with a work area narrower than the pill', () => {
    const bounds = computePillBounds({ size: SIZE, work: { x: 0, y: 0, width: 300, height: 600 } });
    expect(bounds.x).toBe(8);
  });
});

function fakeRegistry(registered = true) {
  const register = vi.fn((_accelerator: string, _callback: () => void) => registered);
  const unregister = vi.fn((_accelerator: string) => undefined);
  const registry: ShortcutRegistry = { register, unregister };
  return { registry, register, unregister };
}

function fakeLogger() {
  const warn = vi.fn();
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
  return { logger, warn };
}

describe('createEscapeKey', () => {
  it('registers Esc while armed and releases it again', () => {
    const { registry, register, unregister } = fakeRegistry();
    const key = createEscapeKey(registry, fakeLogger().logger);
    const onPress = vi.fn();

    expect(key.arm(onPress)).toBe(true);
    expect(register).toHaveBeenCalledWith('Escape', onPress);
    key.disarm();
    expect(unregister).toHaveBeenCalledWith('Escape');
  });

  it('registers only once however often it is armed', () => {
    const { registry, register } = fakeRegistry();
    const key = createEscapeKey(registry, fakeLogger().logger);
    key.arm(vi.fn());
    key.arm(vi.fn());
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('does not release a shortcut it never got', () => {
    const { registry, unregister } = fakeRegistry(false);
    const { logger, warn } = fakeLogger();
    const key = createEscapeKey(registry, logger);

    expect(key.arm(vi.fn())).toBe(false);
    expect(warn).toHaveBeenCalled();
    key.disarm();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('survives a registry that throws', () => {
    const { logger, warn } = fakeLogger();
    const registry: ShortcutRegistry = {
      register: () => {
        throw new Error('invalid accelerator');
      },
      unregister: () => {
        throw new Error('nope');
      },
    };
    const key = createEscapeKey(registry, logger);
    expect(key.arm(vi.fn())).toBe(false);
    key.disarm();
    expect(warn).toHaveBeenCalled();
  });

  it('survives a registry that throws while releasing', () => {
    const { logger, warn } = fakeLogger();
    const registry: ShortcutRegistry = {
      register: () => true,
      unregister: () => {
        throw new Error('gone');
      },
    };
    const key = createEscapeKey(registry, logger);
    key.arm(vi.fn());
    expect(() => key.disarm()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('can be armed again after it was released', () => {
    const { registry, register } = fakeRegistry();
    const key = createEscapeKey(registry, fakeLogger().logger);
    key.arm(vi.fn());
    key.disarm();
    key.arm(vi.fn());
    expect(register).toHaveBeenCalledTimes(2);
  });
});

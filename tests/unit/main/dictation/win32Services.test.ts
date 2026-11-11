import { describe, expect, it, vi } from 'vitest';
import { loadWin32Services } from '@main/dictation/win32Services';
import type { ClipboardPort } from '@main/system/inputInjector';
import type { KoffiLike } from '@main/system/win32';

const clipboard: ClipboardPort = {
  readText: () => Promise.resolve(''),
  writeText: () => Promise.resolve(),
  snapshot: () => Promise.resolve([]),
  restore: () => Promise.resolve(),
};

function logger() {
  const warn = vi.fn();
  return { logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }, warn };
}

describe('loadWin32Services', () => {
  it('binds the window and input helpers from one koffi module', async () => {
    const libraries: string[] = [];
    const koffi: KoffiLike = {
      load: (library) => {
        libraries.push(library);
        return { func: () => vi.fn() };
      },
    };
    const { logger: log, warn } = logger();
    const services = await loadWin32Services({
      clipboard,
      logger: log,
      load: () => Promise.resolve(koffi),
    });

    expect(typeof services?.foreground.current).toBe('function');
    expect(typeof services?.injector.typeText).toBe('function');
    expect(libraries).toEqual(
      expect.arrayContaining(['user32.dll', 'kernel32.dll', 'advapi32.dll']),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers null, with a warning, when the native module cannot be loaded', async () => {
    const { logger: log, warn } = logger();
    const services = await loadWin32Services({
      clipboard,
      logger: log,
      load: () => Promise.reject(new Error('koffi.node was blocked')),
    });
    expect(services).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers null when a Windows library is missing (not Windows)', async () => {
    const { logger: log } = logger();
    const koffi: KoffiLike = {
      load: () => {
        throw new Error('user32.dll was not found');
      },
    };
    await expect(
      loadWin32Services({ clipboard, logger: log, load: () => Promise.resolve(koffi) }),
    ).resolves.toBeNull();
  });
});

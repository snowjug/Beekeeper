import { describe, expect, it, vi } from 'vitest';
import type { PowerShellRunner } from '@main/system/powershell';
import { SystemError } from '@main/system/types';
import { bindSetWallpaper, createWallpaperApi, SPI_SETDESKWALLPAPER } from '@main/system/wallpaper';
import { createShareActions, MAIL_URL } from '@main/studio/share';
import { createLogger, createMemoryFs, makePng } from './support';

const RUNDLL32 = 'C:\\Windows\\System32\\rundll32.exe';
const FILE = 'C:\\Users\\tester\\Pictures\\Beekeeper\\Beekeeper 2026-11-11 13.45.12.png';

function shareSetup(platform: NodeJS.Platform = 'win32') {
  const run = vi.fn((..._args: Parameters<PowerShellRunner['run']>) => Promise.resolve(null));
  const spawnDetached = vi.fn((_file: string, _args: readonly string[]) => Promise.resolve());
  const share = createShareActions({
    runner: { run },
    spawnDetached,
    paths: { rundll32: RUNDLL32 },
    platform,
    logger: createLogger(),
  });
  return { run, spawnDetached, share };
}

describe('share targets', () => {
  it('puts the file on the clipboard through the clipboard-file script, with the path as an argument', async () => {
    const { share, run } = shareSetup();
    await share.copyFile(FILE);
    expect(run).toHaveBeenCalledWith('clipboard-file', { Path: FILE });
  });

  it('opens the "Open with" dialog through rundll32 with the path as its own argument', async () => {
    const { share, spawnDetached } = shareSetup();
    await share.openWith(FILE);
    expect(spawnDetached).toHaveBeenCalledWith(RUNDLL32, ['shell32.dll,OpenAs_RunDLL', FILE]);
  });

  it.each(['relative.png', '-rf', 'C:\\x\u0000.png', 'C:\\x\n.png', ''])(
    'refuses the path %j',
    async (path) => {
      const { share, run, spawnDetached } = shareSetup();
      await expect(share.copyFile(path)).rejects.toThrow('not a file path');
      await expect(share.openWith(path)).rejects.toThrow('not a file path');
      expect(run).not.toHaveBeenCalled();
      expect(spawnDetached).not.toHaveBeenCalled();
    },
  );

  it('only works on Windows', async () => {
    const { share } = shareSetup('linux');
    await expect(share.openWith(FILE)).rejects.toThrow('only available on Windows');
  });

  it('turns a failure to start rundll32 into a readable error', async () => {
    const { share, spawnDetached } = shareSetup();
    spawnDetached.mockRejectedValueOnce(Object.assign(new Error('spawn'), { code: 'ENOENT' }));
    await expect(share.openWith(FILE)).rejects.toBeInstanceOf(SystemError);
  });

  it('shares nothing but a fixed subject in the e-mail link', () => {
    expect(MAIL_URL).toBe('mailto:?subject=Screenshot');
  });
});

// ---- wallpaper ------------------------------------------------------------------------------------

interface FakeKoffi {
  koffi: Parameters<typeof bindSetWallpaper>[0];
  declarations: string[];
  libraries: string[];
  call: ReturnType<typeof vi.fn>;
}

function fakeKoffi(result = 1): FakeKoffi {
  const declarations: string[] = [];
  const libraries: string[] = [];
  const call = vi.fn(
    (_action: number, _parameter: number, _value: Buffer, _flags: number) => result,
  );
  return {
    declarations,
    libraries,
    call,
    koffi: {
      load: (library) => {
        libraries.push(library);
        return {
          func: (definition) => {
            declarations.push(definition);
            return call;
          },
        };
      },
    },
  };
}

describe('bindSetWallpaper', () => {
  it('calls SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, path, UPDATEINIFILE | SENDCHANGE) with a wide string', () => {
    const fake = fakeKoffi();
    const setWallpaper = bindSetWallpaper(fake.koffi);
    expect(setWallpaper('C:\\Wall papers\\a.png')).toBe(true);

    expect(fake.libraries).toEqual(['user32.dll']);
    expect(fake.declarations[0]).toContain('SystemParametersInfoW');
    const [action, parameter, value, flags] = fake.call.mock.calls[0] as [
      number,
      number,
      Buffer,
      number,
    ];
    expect(action).toBe(SPI_SETDESKWALLPAPER);
    expect(action).toBe(0x14);
    expect(parameter).toBe(0);
    expect(flags).toBe(3);
    expect(value.toString('utf16le')).toBe('C:\\Wall papers\\a.png\0');
  });

  it('reports false when Windows refuses', () => {
    expect(bindSetWallpaper(fakeKoffi(0).koffi)('C:\\a.png')).toBe(false);
  });

  it('refuses a path with a NUL character', () => {
    expect(() => bindSetWallpaper(fakeKoffi().koffi)('C:\\a\0.png')).toThrow('not valid');
  });
});

describe('createWallpaperApi', () => {
  const DIRECTORY = 'C:\\Users\\tester\\AppData\\Roaming\\Beekeeper\\wallpaper';
  const png = makePng(1920, 1080);

  function wallpaperSetup(options: { result?: number; platform?: NodeJS.Platform } = {}) {
    const fs = createMemoryFs();
    const fake = fakeKoffi(options.result);
    let time = new Date(2026, 10, 11, 13, 45, 12);
    const loadKoffi = vi.fn(() => Promise.resolve(fake.koffi));
    const api = createWallpaperApi({
      directory: DIRECTORY,
      fs,
      logger: createLogger(),
      loadKoffi,
      platform: options.platform ?? 'win32',
      now: () => time,
    });
    return {
      api,
      fs,
      fake,
      loadKoffi,
      advance: (seconds: number) => {
        time = new Date(time.getTime() + seconds * 1000);
      },
    };
  }

  it('saves the PNG into the wallpaper folder and applies it', async () => {
    const { api, fs, fake } = wallpaperSetup();
    const path = await api.setFromPng(png);
    expect(path).toBe(`${DIRECTORY}\\wallpaper-20261111-134512.png`);
    expect(fs.files.get(path.toLowerCase())).toEqual(png);
    const [, , value] = fake.call.mock.calls[0] as [number, number, Buffer, number];
    expect(value.toString('utf16le')).toBe(`${path}\0`);
  });

  it('loads koffi once, on first use', async () => {
    const { api, loadKoffi, advance } = wallpaperSetup();
    expect(loadKoffi).not.toHaveBeenCalled();
    await api.setFromPng(png);
    advance(1);
    await api.setFromPng(png);
    expect(loadKoffi).toHaveBeenCalledOnce();
  });

  it('gives a new name to an image set in the same second', async () => {
    const { api } = wallpaperSetup();
    const first = await api.setFromPng(png);
    const second = await api.setFromPng(png);
    expect(second).not.toBe(first);
    expect(second.endsWith('-2.png')).toBe(true);
  });

  it('keeps the three newest images and removes older ones', async () => {
    const { api, fs, advance } = wallpaperSetup();
    for (let index = 0; index < 5; index += 1) {
      await api.setFromPng(png);
      advance(60);
    }
    expect(await fs.list(DIRECTORY)).toEqual([
      'wallpaper-20261111-134712.png',
      'wallpaper-20261111-134812.png',
      'wallpaper-20261111-134912.png',
    ]);
  });

  it('never touches other files in the folder', async () => {
    const { api, fs, advance } = wallpaperSetup();
    fs.files.set(`${DIRECTORY}\\notes.txt`.toLowerCase(), Buffer.from('keep me'));
    for (let index = 0; index < 5; index += 1) {
      await api.setFromPng(png);
      advance(60);
    }
    expect(fs.files.has(`${DIRECTORY}\\notes.txt`.toLowerCase())).toBe(true);
  });

  it('explains that it is unavailable when the native module cannot be loaded, and tries again next time', async () => {
    const fs = createMemoryFs();
    const fake = fakeKoffi();
    const loadKoffi = vi
      .fn()
      .mockRejectedValueOnce(new Error('dlopen failed'))
      .mockResolvedValue(fake.koffi);
    const api = createWallpaperApi({
      directory: DIRECTORY,
      fs,
      logger: createLogger(),
      loadKoffi,
      platform: 'win32',
    });
    await expect(api.setFromPng(png)).rejects.toMatchObject({
      code: 'unsupported',
      message: 'Changing the wallpaper is not available on this PC.',
    });
    expect(fs.files.size).toBe(0);
    await expect(api.setFromPng(png)).resolves.toContain('wallpaper-');
  });

  it('explains a refusal by Windows', async () => {
    const { api } = wallpaperSetup({ result: 0 });
    await expect(api.setFromPng(png)).rejects.toMatchObject({
      code: 'failed',
      message: 'Windows did not let Beekeeper change the wallpaper.',
    });
  });

  it('explains a failure to save the image', async () => {
    const { api, fs } = wallpaperSetup();
    fs.unwritable.add(DIRECTORY.toLowerCase());
    await expect(api.setFromPng(png)).rejects.toMatchObject({
      code: 'failed',
      message: 'Could not save the wallpaper image.',
    });
  });

  it('refuses to run when there is no image or the platform is not Windows', async () => {
    await expect(wallpaperSetup().api.setFromPng(new Uint8Array())).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(wallpaperSetup({ platform: 'darwin' }).api.setFromPng(png)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('still succeeds when pruning old images fails', async () => {
    const { api, fs } = wallpaperSetup();
    fs.list = () => Promise.reject(new Error('cannot list'));
    await expect(api.setFromPng(png)).resolves.toContain('wallpaper-');
  });
});

import { win32 } from 'node:path';
import type { Logger } from '@shared/logger';
import { assertWindows } from './exec';
import { SystemError } from './types';

/** SystemParametersInfo action that sets the desktop wallpaper. */
export const SPI_SETDESKWALLPAPER = 0x14;
/** Write the new wallpaper to the user profile and tell every window about the change. */
export const SPIF_UPDATEINIFILE_SENDCHANGE = 0x01 | 0x02;

/** The slice of the koffi API that is used (the native module stays out of the type surface). */
export interface KoffiLoader {
  load: (library: string) => { func: (definition: string) => unknown };
}

type SystemParametersInfo = (
  action: number,
  parameter: number,
  value: Buffer,
  flags: number,
) => number;

/** Sets the desktop wallpaper to an image file; false when Windows refused. */
export type SetWallpaper = (path: string) => boolean;

/** Binds SystemParametersInfoW(SPI_SETDESKWALLPAPER) through koffi. */
export function bindSetWallpaper(koffi: KoffiLoader): SetWallpaper {
  const user32 = koffi.load('user32.dll');
  const call = user32.func(
    'int __stdcall SystemParametersInfoW(uint32 uiAction, uint32 uiParam, void *pvParam, uint32 fWinIni)',
  ) as SystemParametersInfo;
  return (path) => {
    if (path.includes('\0')) throw new RangeError('The wallpaper path is not valid.');
    const wide = Buffer.from(`${path}\0`, 'utf16le');
    return call(SPI_SETDESKWALLPAPER, 0, wide, SPIF_UPDATEINIFILE_SENDCHANGE) !== 0;
  };
}

/** The file operations the wallpaper folder needs. */
export interface WallpaperFs {
  mkdir(path: string): Promise<void>;
  /** Fails with EEXIST when the file already exists. */
  writeNewFile(path: string, data: Uint8Array): Promise<void>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export interface WallpaperOptions {
  /** Folder that receives the images (userData\wallpaper). */
  directory: string;
  fs: WallpaperFs;
  logger: Logger;
  /** Loads koffi on first use, so a missing or blocked native module never stops the app from starting. */
  loadKoffi?: () => Promise<KoffiLoader>;
  platform?: NodeJS.Platform;
  now?: () => Date;
  /** Images kept in the folder (the newest). Default 3. */
  keep?: number;
}

export interface WallpaperApi {
  /** Saves the PNG into the wallpaper folder and makes it the desktop wallpaper; resolves with its path. */
  setFromPng(png: Uint8Array): Promise<string>;
}

const FILE_NAME = /^wallpaper-\d{8}-\d{6}(?:-\d+)?\.png$/;
const MAX_NAME_ATTEMPTS = 20;
const DEFAULT_KEEP = 3;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function fileName(date: Date, attempt: number): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `wallpaper-${day}-${time}${attempt > 1 ? `-${attempt}` : ''}.png`;
}

async function loadKoffi(): Promise<KoffiLoader> {
  const module = (await import('koffi')) as unknown as KoffiLoader & { default?: KoffiLoader };
  return module.default ?? module;
}

/** Sets the wallpaper from an image in memory. Windows keeps reading the file, so it is kept on disk. */
export function createWallpaperApi(options: WallpaperOptions): WallpaperApi {
  const { directory, fs, logger } = options;
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  const keep = options.keep ?? DEFAULT_KEEP;
  const load = options.loadKoffi ?? loadKoffi;
  let binding: Promise<SetWallpaper> | undefined;

  const bind = (): Promise<SetWallpaper> => {
    binding ??= load().then(bindSetWallpaper);
    return binding;
  };

  async function writeImage(png: Uint8Array): Promise<string> {
    await fs.mkdir(directory);
    const takenAt = now();
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
      const path = win32.join(directory, fileName(takenAt, attempt));
      try {
        await fs.writeNewFile(path, png);
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('No free file name for the wallpaper.');
  }

  async function prune(): Promise<void> {
    try {
      const names = (await fs.list(directory)).filter((name) => FILE_NAME.test(name)).sort();
      for (const name of names.slice(0, Math.max(0, names.length - keep))) {
        await fs.remove(win32.join(directory, name));
      }
    } catch (error) {
      logger.debug('Could not remove old wallpaper images', error);
    }
  }

  return {
    async setFromPng(png) {
      assertWindows(platform);
      if (png.length === 0) throw new SystemError('invalid-argument', 'There is no image to use.');
      let apply: SetWallpaper;
      try {
        apply = await bind();
      } catch (error) {
        binding = undefined;
        logger.warn('Changing the wallpaper is unavailable (koffi did not load)', error);
        throw new SystemError(
          'unsupported',
          'Changing the wallpaper is not available on this PC.',
          {
            cause: error,
          },
        );
      }

      let path: string;
      try {
        path = await writeImage(png);
      } catch (error) {
        logger.warn('Could not save the wallpaper image', error);
        throw new SystemError('failed', 'Could not save the wallpaper image.', { cause: error });
      }

      let applied = false;
      try {
        applied = apply(path);
      } catch (error) {
        logger.warn('SystemParametersInfo threw', error);
      }
      if (!applied)
        throw new SystemError('failed', 'Windows did not let Beekeeper change the wallpaper.');
      await prune();
      return path;
    },
  };
}

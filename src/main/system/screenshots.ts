import { win32 } from 'node:path';
import type { SystemFs } from './systemFs';
import { SystemError, type ScreenshotResult, type SystemApi } from './types';

export type ScreenshotApi = Pick<SystemApi, 'takeScreenshot'>;

export interface CapturedScreen {
  png: Buffer;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  /** Grabs the display under the cursor as PNG (implemented by src/main/capture). */
  capture: () => Promise<CapturedScreen>;
  /** Folder that receives the files, e.g. Pictures\Beekeeper. Created on demand. */
  picturesDir: string;
  fs: SystemFs;
  now: () => number;
}

const MAX_NAME_ATTEMPTS = 50;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "Screenshot 2026-11-10 16-20-53.png"; later attempts in the same second get " (2)", " (3)"... */
export function screenshotFileName(date: Date, attempt = 1): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `Screenshot ${day} ${time}${attempt > 1 ? ` (${attempt})` : ''}.png`;
}

export function createScreenshotApi(options: ScreenshotOptions): ScreenshotApi {
  const { capture, picturesDir, fs, now } = options;
  return {
    async takeScreenshot(): Promise<ScreenshotResult> {
      let captured: Awaited<ReturnType<typeof capture>>;
      try {
        captured = await capture();
      } catch (error) {
        throw new SystemError('failed', 'Could not capture the screen.', { cause: error });
      }
      const { png, width, height } = captured;
      if (png.length === 0 || !Number.isInteger(width) || !Number.isInteger(height)) {
        throw new SystemError('failed', 'The screen capture was empty.');
      }

      try {
        await fs.mkdir(picturesDir);
      } catch (error) {
        throw new SystemError('failed', 'Could not create the Pictures\\Beekeeper folder.', {
          cause: error,
        });
      }

      const takenAt = new Date(now());
      for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
        const path = win32.join(picturesDir, screenshotFileName(takenAt, attempt));
        try {
          await fs.writeNewFile(path, png);
          return { path, width, height };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw new SystemError('failed', 'Could not save the screenshot.', { cause: error });
        }
      }
      throw new SystemError('failed', 'Could not find a free file name for the screenshot.');
    },
  };
}

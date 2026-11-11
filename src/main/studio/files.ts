import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { win32 } from 'node:path';

/** The file operations Capture Studio needs, so unit tests can run on an in-memory fake. */
export interface StudioFs {
  mkdir(path: string): Promise<void>;
  /** Fails with EEXIST when the file already exists. */
  writeNewFile(path: string, data: Uint8Array): Promise<void>;
  /** Replaces the content of a file; a crash never leaves a half-written file behind. */
  overwriteFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  /** File names (not paths) of a folder; an empty list when it does not exist. */
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export const nodeStudioFs: StudioFs = {
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeNewFile(path, data) {
    await writeFile(path, data, { flag: 'wx' });
  },
  async overwriteFile(path, data) {
    const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  readFile: (path) => readFile(path),
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  async list(path) {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  },
  async remove(path) {
    await rm(path, { force: true });
  },
};

const MAX_NAME_ATTEMPTS = 50;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "Beekeeper 2026-11-11 13.45.12.png"; later attempts in the same second get " (2)", " (3)"... */
export function screenshotFileName(date: Date, attempt = 1): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Beekeeper ${day} ${time}${attempt > 1 ? ` (${attempt})` : ''}.png`;
}

/** The folder configured in Settings, when it is a usable absolute Windows path; otherwise null. */
export function configuredFolder(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || CONTROL_CHARS.test(trimmed) || !win32.isAbsolute(trimmed)) return null;
  const normalized = win32.normalize(trimmed);
  return normalized.length > 3 ? normalized.replace(/[\\/]+$/, '') : normalized;
}

/** Folders to try for a new screenshot, best first: the configured one, then Pictures\Beekeeper. */
export function saveFolders(configured: string, picturesDir: string): string[] {
  const custom = configuredFolder(configured);
  return custom && custom.toLowerCase() !== picturesDir.toLowerCase()
    ? [custom, picturesDir]
    : [picturesDir];
}

function isExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

/** Writes a PNG with a free "Beekeeper <date> <time>.png" name into the first folder that works. */
export async function writeNewScreenshot(
  fs: StudioFs,
  folders: readonly string[],
  png: Uint8Array,
  now: Date,
): Promise<string> {
  let failure: unknown = new Error('No folder to save into.');
  for (const folder of folders) {
    try {
      await fs.mkdir(folder);
      for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
        const path = win32.join(folder, screenshotFileName(now, attempt));
        try {
          await fs.writeNewFile(path, png);
          return path;
        } catch (error) {
          if (!isExists(error)) throw error;
        }
      }
      throw new Error('Could not find a free file name.');
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

/** True when `path` is a file the Studio may overwrite or move to the Recycle Bin: an absolute .png. */
export function isPngPath(path: string): boolean {
  return win32.isAbsolute(path) && !CONTROL_CHARS.test(path) && /\.png$/i.test(path);
}

import { describe, expect, it, vi } from 'vitest';
import { createScreenshotApi, screenshotFileName } from '@main/system/screenshots';
import { SystemError } from '@main/system/types';
import { createMemoryFs } from './support';

const PICTURES = 'C:\\Users\\me\\Pictures\\Beekeeper';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// 16:20:53 local time, whatever the time zone of the machine running the tests
const TAKEN_AT = new Date(2026, 10, 10, 16, 20, 53).getTime();

describe('screenshotFileName', () => {
  it.each([
    [new Date(2026, 10, 10, 16, 20, 53), 1, 'Screenshot 2026-11-10 16-20-53.png'],
    [new Date(2026, 0, 2, 3, 4, 5), 1, 'Screenshot 2026-01-02 03-04-05.png'],
    [new Date(2026, 11, 31, 23, 59, 59), 2, 'Screenshot 2026-12-31 23-59-59 (2).png'],
    [new Date(2026, 5, 5, 0, 0, 0), 12, 'Screenshot 2026-06-05 00-00-00 (12).png'],
  ])('names %s attempt %d as %s', (date, attempt, expected) => {
    expect(screenshotFileName(date, attempt)).toBe(expected);
  });
});

function setup(
  options: {
    files?: string[];
    capture?: () => Promise<{ png: Buffer; width: number; height: number }>;
  } = {},
) {
  const fs = createMemoryFs(options.files);
  const capture = vi.fn(
    options.capture ?? (() => Promise.resolve({ png: PNG, width: 1920, height: 1080 })),
  );
  const api = createScreenshotApi({ capture, picturesDir: PICTURES, fs, now: () => TAKEN_AT });
  return { api, fs, capture };
}

describe('takeScreenshot', () => {
  it('saves the capture into the Pictures folder and creates it on demand', async () => {
    const { api, fs, capture } = setup();
    expect(fs.dirs.has(PICTURES.toLowerCase())).toBe(false);

    const result = await api.takeScreenshot();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      path: `${PICTURES}\\Screenshot 2026-11-10 16-20-53.png`,
      width: 1920,
      height: 1080,
    });
    expect(fs.dirs.has(PICTURES.toLowerCase())).toBe(true);
    expect(fs.files.get(result.path.toLowerCase())).toBe(PNG);
  });

  it('never overwrites a screenshot taken in the same second', async () => {
    const taken = `${PICTURES}\\Screenshot 2026-11-10 16-20-53.png`;
    const { api, fs } = setup({
      files: [taken, `${PICTURES}\\Screenshot 2026-11-10 16-20-53 (2).png`],
    });
    const result = await api.takeScreenshot();
    expect(result.path).toBe(`${PICTURES}\\Screenshot 2026-11-10 16-20-53 (3).png`);
    expect(fs.files.size).toBe(3);
  });

  it('reports a capture that fails or comes back empty', async () => {
    const failing = setup({ capture: () => Promise.reject(new Error('no display')) });
    await expect(failing.api.takeScreenshot()).rejects.toMatchObject({
      code: 'failed',
      message: 'Could not capture the screen.',
    });

    for (const capture of [
      () => Promise.resolve({ png: Buffer.alloc(0), width: 1920, height: 1080 }),
      () => Promise.resolve({ png: PNG, width: 0.5, height: 1080 }),
      () => Promise.resolve({ png: PNG, width: 1920, height: Number.NaN }),
    ]) {
      const { api, fs } = setup({ capture });
      await expect(api.takeScreenshot()).rejects.toMatchObject({
        code: 'failed',
        message: 'The screen capture was empty.',
      });
      expect(fs.files.size).toBe(0);
    }
  });

  it('reports a folder or file that cannot be written', async () => {
    const noFolder = setup();
    noFolder.fs.mkdir = () => Promise.reject(new Error('EACCES'));
    await expect(noFolder.api.takeScreenshot()).rejects.toMatchObject({
      message: 'Could not create the Pictures\\Beekeeper folder.',
    });

    const noFile = setup();
    noFile.fs.writeNewFile = () =>
      Promise.reject(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
    const error = await noFile.api.takeScreenshot().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SystemError);
    expect(error).toMatchObject({ code: 'failed', message: 'Could not save the screenshot.' });
  });

  it('gives up when every candidate name is taken', async () => {
    const { api, fs } = setup();
    fs.writeNewFile = () => Promise.reject(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));
    await expect(api.takeScreenshot()).rejects.toMatchObject({
      message: 'Could not find a free file name for the screenshot.',
    });
  });
});

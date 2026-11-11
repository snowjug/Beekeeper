import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  configuredFolder,
  isPngPath,
  nodeStudioFs,
  saveFolders,
  screenshotFileName,
  writeNewScreenshot,
} from '@main/studio/files';
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, readPngSize } from '@main/studio/png';
import { createMemoryFs, makePng, PICTURES } from './support';

describe('readPngSize', () => {
  it('reads the size of a complete PNG', () => {
    expect(readPngSize(makePng(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(readPngSize(makePng(1, 1))).toEqual({ width: 1, height: 1 });
    expect(readPngSize(makePng(MAX_IMAGE_SIDE, 5_000))).toEqual({
      width: MAX_IMAGE_SIDE,
      height: 5_000,
    });
  });

  it('refuses bytes that are not a PNG', () => {
    expect(readPngSize(new Uint8Array())).toBeNull();
    expect(
      readPngSize(Buffer.from('GIF89a......................................................')),
    ).toBeNull();
    expect(readPngSize(Buffer.alloc(200, 1))).toBeNull();
  });

  it('refuses a PNG whose header or end is damaged', () => {
    const noHeader = makePng();
    noHeader.write('JUNK', 12, 'ascii');
    expect(readPngSize(noHeader)).toBeNull();

    const wrongLength = makePng();
    wrongLength.writeUInt32BE(14, 8);
    expect(readPngSize(wrongLength)).toBeNull();

    const full = makePng();
    expect(readPngSize(full.subarray(0, full.length - 1))).toBeNull();
    expect(readPngSize(full.subarray(0, 40))).toBeNull();
  });

  it('refuses an empty or oversized image', () => {
    expect(readPngSize(makePng(0, 10))).toBeNull();
    expect(readPngSize(makePng(10, 0))).toBeNull();
    expect(readPngSize(makePng(MAX_IMAGE_SIDE + 1, 10))).toBeNull();
    expect(readPngSize(makePng(10, MAX_IMAGE_SIDE + 1))).toBeNull();
    const side = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    expect(readPngSize(makePng(side, side))).toBeNull();
    expect(readPngSize(makePng(0xffffffff, 0xffffffff))).toBeNull();
  });
});

describe('screenshotFileName', () => {
  const taken = new Date(2026, 10, 11, 3, 5, 9);

  it('names the file after the date and time', () => {
    expect(screenshotFileName(taken)).toBe('Beekeeper 2026-11-11 03.05.09.png');
  });

  it('numbers later files of the same second', () => {
    expect(screenshotFileName(taken, 2)).toBe('Beekeeper 2026-11-11 03.05.09 (2).png');
    expect(screenshotFileName(taken, 12)).toBe('Beekeeper 2026-11-11 03.05.09 (12).png');
  });
});

describe('save folders', () => {
  it.each([
    ['D:\\Shots', 'D:\\Shots'],
    ['  D:\\Shots\\  ', 'D:\\Shots'],
    ['D:/Shots/Work', 'D:\\Shots\\Work'],
    ['D:\\', 'D:\\'],
    ['\\\\server\\share\\shots', '\\\\server\\share\\shots'],
    ['D:\\a\\..\\b', 'D:\\b'],
  ])('accepts "%s"', (value, expected) => {
    expect(configuredFolder(value)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'relative\\folder',
    'Shots',
    'D:shots',
    'D:\\bad\u0000name',
    'D:\\bad\nname',
  ])('rejects %j', (value) => {
    expect(configuredFolder(value)).toBeNull();
  });

  it('tries the configured folder first and Pictures\\Beekeeper second', () => {
    expect(saveFolders('D:\\Shots', PICTURES)).toEqual(['D:\\Shots', PICTURES]);
    expect(saveFolders('', PICTURES)).toEqual([PICTURES]);
    expect(saveFolders('nonsense', PICTURES)).toEqual([PICTURES]);
    expect(saveFolders(PICTURES.toUpperCase(), PICTURES)).toEqual([PICTURES]);
  });
});

describe('isPngPath', () => {
  it.each(['C:\\a\\b.png', 'C:\\a\\B.PNG', '\\\\server\\share\\x.png'])('accepts %s', (path) => {
    expect(isPngPath(path)).toBe(true);
  });

  it.each(['b.png', 'C:\\a\\b.jpg', 'C:\\a\\b.png.exe', 'C:\\a\\b\u0000.png', 'C:\\a\\png', ''])(
    'rejects %j',
    (path) => {
      expect(isPngPath(path)).toBe(false);
    },
  );
});

describe('writeNewScreenshot', () => {
  const NOW = new Date(2026, 10, 11, 13, 45, 12);
  const png = makePng();

  it('creates the folder and writes the file', async () => {
    const fs = createMemoryFs();
    const path = await writeNewScreenshot(fs, [PICTURES], png, NOW);
    expect(path).toBe(`${PICTURES}\\Beekeeper 2026-11-11 13.45.12.png`);
    expect(fs.folders.has(PICTURES.toLowerCase())).toBe(true);
    expect(fs.files.get(path.toLowerCase())).toEqual(png);
  });

  it('never overwrites: a taken name gets a number', async () => {
    const fs = createMemoryFs();
    const first = await writeNewScreenshot(fs, [PICTURES], png, NOW);
    const second = await writeNewScreenshot(fs, [PICTURES], png, NOW);
    const third = await writeNewScreenshot(fs, [PICTURES], png, NOW);
    expect([first, second, third].map((path) => path.split('\\').pop())).toEqual([
      'Beekeeper 2026-11-11 13.45.12.png',
      'Beekeeper 2026-11-11 13.45.12 (2).png',
      'Beekeeper 2026-11-11 13.45.12 (3).png',
    ]);
  });

  it('moves on to the next folder when one cannot be used', async () => {
    const fs = createMemoryFs();
    fs.unwritable.add('d:\\locked');
    const path = await writeNewScreenshot(fs, ['D:\\Locked', PICTURES], png, NOW);
    expect(path.startsWith(PICTURES)).toBe(true);
  });

  it('fails when no folder works', async () => {
    const fs = createMemoryFs();
    fs.unwritable.add(PICTURES.toLowerCase());
    await expect(writeNewScreenshot(fs, [PICTURES], png, NOW)).rejects.toThrow('EACCES');
    await expect(writeNewScreenshot(fs, [], png, NOW)).rejects.toThrow('No folder');
  });
});

describe('nodeStudioFs', () => {
  const root = mkdtempSync(join(tmpdir(), 'beekeeper-studio-fs-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates folders, refuses to overwrite with writeNewFile and replaces with overwriteFile', async () => {
    const folder = join(root, 'a', 'b');
    await nodeStudioFs.mkdir(folder);
    const file = join(folder, 'shot.png');
    await nodeStudioFs.writeNewFile(file, Buffer.from('one'));
    await expect(nodeStudioFs.writeNewFile(file, Buffer.from('two'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await nodeStudioFs.overwriteFile(file, Buffer.from('three'));
    expect((await nodeStudioFs.readFile(file)).toString()).toBe('three');
    // The temporary file used for the atomic replace is gone.
    expect(await nodeStudioFs.list(folder)).toEqual(['shot.png']);
  });

  it('reports what exists, lists folders and removes files', async () => {
    const file = join(root, 'x.png');
    expect(await nodeStudioFs.exists(file)).toBe(false);
    expect(await nodeStudioFs.list(join(root, 'nope'))).toEqual([]);
    await nodeStudioFs.writeNewFile(file, Buffer.from('x'));
    expect(await nodeStudioFs.exists(file)).toBe(true);
    await nodeStudioFs.remove(file);
    expect(await nodeStudioFs.exists(file)).toBe(false);
    await expect(nodeStudioFs.remove(file)).resolves.toBeUndefined();
  });

  it('cleans up when the replace fails', async () => {
    const folder = join(root, 'dir-target');
    await nodeStudioFs.mkdir(folder);
    // Renaming a file onto a directory fails; no temporary file may stay behind.
    await expect(nodeStudioFs.overwriteFile(folder, Buffer.from('x'))).rejects.toThrow();
    expect(await nodeStudioFs.list(root)).not.toContainEqual(expect.stringMatching(/\.tmp$/));
  });
});

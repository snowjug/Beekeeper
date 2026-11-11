import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeFs } from '@main/system/systemFs';

// Scratch folder inside the repository, removed again when the tests finish.
const SCRATCH = join(process.cwd(), 'tests', 'unit', 'main', 'system', '.scratch-systemfs');

describe('nodeFs', () => {
  afterAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it('lists folder entries with their types', async () => {
    const entries = await nodeFs.readdir(join(process.cwd(), 'src', 'main'));
    expect(entries).toContainEqual({ name: 'system', isDirectory: true, isFile: false });
    const system = await nodeFs.readdir(join(process.cwd(), 'src', 'main', 'system'));
    expect(system).toContainEqual({ name: 'apps.ts', isDirectory: false, isFile: true });
  });

  it('rejects when a folder cannot be read', async () => {
    await expect(nodeFs.readdir(join(SCRATCH, 'missing'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('tells existing from missing paths without throwing', async () => {
    expect(await nodeFs.exists(join(process.cwd(), 'package.json'))).toBe(true);
    expect(await nodeFs.exists(join(process.cwd(), 'src'))).toBe(true);
    expect(await nodeFs.exists(join(SCRATCH, 'nothing-here.txt'))).toBe(false);
  });

  it('creates nested folders and writes a new file only once', async () => {
    const folder = join(SCRATCH, 'a', 'b');
    await nodeFs.mkdir(folder);
    await nodeFs.mkdir(folder);
    const file = join(folder, 'shot.png');

    await nodeFs.writeNewFile(file, Uint8Array.from([1, 2, 3]));
    expect([...readFileSync(file)]).toEqual([1, 2, 3]);

    await expect(nodeFs.writeNewFile(file, Uint8Array.from([9]))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect([...readFileSync(file)]).toEqual([1, 2, 3]);
  });

  it('fails to write into a folder that does not exist', async () => {
    mkdirSync(SCRATCH, { recursive: true });
    await expect(
      nodeFs.writeNewFile(join(SCRATCH, 'no', 'such', 'folder', 'x.png'), new Uint8Array()),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

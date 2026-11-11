import { access, mkdir, readdir, writeFile } from 'node:fs/promises';

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** The few filesystem operations the system layer needs, so tests can run on an in-memory fake. */
export interface SystemFs {
  readdir(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Fails with EEXIST when the file already exists. */
  writeNewFile(path: string, data: Uint8Array): Promise<void>;
}

export const nodeFs: SystemFs = {
  async readdir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  },
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeNewFile(path, data) {
    await writeFile(path, data, { flag: 'wx' });
  },
};

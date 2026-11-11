import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

/**
 * Size-based rotation for electron-log: main.log -> main.1.log -> ... -> main.<maxFiles-1>.log,
 * the oldest file is dropped. With maxFiles = 5 and a 5 MB size limit the logs never exceed 25 MB.
 */
export function rotateLogFile(file: string, maxFiles: number): void {
  const { dir, name, ext } = parse(file);
  const archive = (index: number): string => join(dir, `${name}.${index}${ext}`);

  rmSync(archive(maxFiles - 1), { force: true });
  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    if (existsSync(archive(index))) renameSync(archive(index), archive(index + 1));
  }
  if (existsSync(file)) renameSync(file, archive(1));
}

/** Names of the log files currently on disk (current first), for diagnostics and tests. */
export function listLogFiles(file: string): string[] {
  const { dir, name, ext } = parse(file);
  if (!existsSync(dirname(file))) return [];
  return readdirSync(dir)
    .filter(
      (entry) => entry === `${name}${ext}` || new RegExp(`^${name}\\.\\d+${ext}$`).test(entry),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

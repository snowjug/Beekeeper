import { win32 } from 'node:path';
import type { ExecFileFn, ExecFileOptions, ExecFileResult } from '@main/system/exec';
import type {
  PowerShellRunOptions,
  PowerShellRunner,
  PowerShellScript,
  ScriptArgs,
} from '@main/system/powershell';
import type { DirEntry, SystemFs } from '@main/system/systemFs';
import type { InstalledApp } from '@main/system/types';
import { normalizeAppName } from '@main/system/appAliases';

export interface ExecCall {
  file: string;
  args: readonly string[];
  options: ExecFileOptions | undefined;
}

type ExecHandler = (call: ExecCall) => ExecFileResult | Promise<ExecFileResult>;

/** An ExecFileFn that records its calls and answers through `handler` (default: empty output). */
export function fakeExec(handler: ExecHandler = () => ({ stdout: '', stderr: '' })): {
  exec: ExecFileFn;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec: ExecFileFn = async (file, args, options) => {
    const call = { file, args, options };
    calls.push(call);
    return await handler(call);
  };
  return { exec, calls };
}

export interface RunnerCall {
  script: PowerShellScript;
  args: ScriptArgs;
  options: PowerShellRunOptions;
}

/** A PowerShellRunner that records its calls and returns whatever `handler` produces (or throws). */
export function fakeRunner(handler: (call: RunnerCall) => unknown): {
  runner: PowerShellRunner;
  calls: RunnerCall[];
} {
  const calls: RunnerCall[] = [];
  const runner: PowerShellRunner = {
    async run(script, args = {}, options = {}) {
      const call = { script, args, options };
      calls.push(call);
      return await Promise.resolve(handler(call));
    },
  };
  return { runner, calls };
}

export function successReply(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

export function failureReply(code: string, message: string): string {
  return JSON.stringify({ ok: false, code, message });
}

/** Error shaped like the ones child_process rejects with. */
export function childProcessError(
  fields: { code?: string | number; killed?: boolean; stderr?: string; stdout?: string },
  message = 'Command failed',
): Error {
  return Object.assign(new Error(message), fields);
}

// ---------------------------------------------------------------------------
// In-memory filesystem
// ---------------------------------------------------------------------------

export interface MemoryFs extends SystemFs {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
}

function key(path: string): string {
  return win32
    .normalize(path)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

/** Builds a filesystem from absolute file paths; their parent folders exist implicitly. */
export function createMemoryFs(
  filePaths: readonly string[] = [],
  options: { unreadable?: readonly string[] } = {},
): MemoryFs {
  const names = new Map<string, string>();
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const unreadable = new Set((options.unreadable ?? []).map(key));

  const addDirectory = (path: string): void => {
    let current = win32.normalize(path).replace(/[\\/]+$/, '');
    while (current !== '' && !dirs.has(key(current))) {
      dirs.add(key(current));
      names.set(key(current), current);
      const parent = win32.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };
  for (const path of filePaths) {
    files.set(key(path), new Uint8Array());
    names.set(key(path), path);
    addDirectory(win32.dirname(path));
  }

  return {
    files,
    dirs,
    readdir(path) {
      const directory = key(path);
      if (unreadable.has(directory) || !dirs.has(directory)) {
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      }
      const entries: DirEntry[] = [];
      for (const [candidate, name] of names) {
        if (candidate === directory || key(win32.dirname(name)) !== directory) continue;
        entries.push({
          name: win32.basename(name),
          isDirectory: dirs.has(candidate),
          isFile: files.has(candidate),
        });
      }
      return Promise.resolve(entries);
    },
    exists: (path) => Promise.resolve(files.has(key(path)) || dirs.has(key(path))),
    mkdir(path) {
      addDirectory(path);
      return Promise.resolve();
    },
    writeNewFile(path, data) {
      if (files.has(key(path))) {
        return Promise.reject(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));
      }
      addDirectory(win32.dirname(path));
      files.set(key(path), data);
      names.set(key(path), path);
      return Promise.resolve();
    },
  };
}

export function app(
  name: string,
  kind: InstalledApp['kind'] = 'shortcut',
  target = `C:\\Programs\\${name}.lnk`,
): InstalledApp {
  return { name, key: normalizeAppName(name), kind, target };
}

export const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

import { execFile, spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import { SystemError } from './types';

export interface ExecFileOptions {
  /** Kills the process after this many milliseconds. 0 or undefined: no limit. */
  timeout?: number;
  /** Default true. */
  windowsHide?: boolean;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a program with an argument ARRAY (never a shell string) and resolves with its output.
 * Rejects with the Node child-process error (code, killed, stdout, stderr) on failure.
 */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<ExecFileResult>;

export interface SpawnDetachedOptions {
  /** Hides the window of the started program (used for console helpers such as cmd.exe). */
  hidden?: boolean;
}

/** Starts a program that outlives Beekeeper's interest in it; resolves once it has started. */
export type SpawnDetachedFn = (
  file: string,
  args: readonly string[],
  options?: SpawnDetachedOptions,
) => Promise<void>;

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export const defaultExecFile: ExecFileFn = async (file, args, options = {}) => {
  const { stdout, stderr } = await execFileAsync(file, [...args], {
    encoding: 'utf8',
    windowsHide: options.windowsHide ?? true,
    timeout: options.timeout ?? 0,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return { stdout, stderr };
};

export const defaultSpawnDetached: SpawnDetachedFn = (file, args, options = {}) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(file, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: options.hidden === true,
    });
    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

// ---------------------------------------------------------------------------
// Environment and well-known programs
// ---------------------------------------------------------------------------

/** Case-insensitive environment lookup (Windows variables are case-insensitive, plain objects are not). */
export function getEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (direct !== undefined) return direct;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export interface SystemPaths {
  powershell: string;
  explorer: string;
  cmd: string;
  rundll32: string;
  shutdown: string;
  taskkill: string;
}

/**
 * Absolute paths of the Windows programs Beekeeper starts. Bare names would make CreateProcess look in
 * the application and working directories first, which lets a stray executable shadow a system tool.
 */
export function resolveSystemPaths(env: NodeJS.ProcessEnv): SystemPaths {
  const root = getEnv(env, 'SystemRoot') ?? getEnv(env, 'windir') ?? 'C:\\Windows';
  const system32 = win32.join(root, 'System32');
  return {
    powershell: win32.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    explorer: win32.join(root, 'explorer.exe'),
    cmd: win32.join(system32, 'cmd.exe'),
    rundll32: win32.join(system32, 'rundll32.exe'),
    shutdown: win32.join(system32, 'shutdown.exe'),
    taskkill: win32.join(system32, 'taskkill.exe'),
  };
}

export function assertWindows(platform: NodeJS.Platform): void {
  if (platform !== 'win32') {
    throw new SystemError('unsupported', 'This feature is only available on Windows.');
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

interface ChildProcessFailure {
  code?: unknown;
  killed?: unknown;
  stderr?: unknown;
  message?: unknown;
}

function firstLine(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line === undefined ? undefined : line.slice(0, 300);
}

/** Maps a child-process failure to a SystemError; `what` names the thing that failed. */
export function toSystemError(error: unknown, what: string): SystemError {
  if (error instanceof SystemError) return error;
  const failure: ChildProcessFailure = typeof error === 'object' && error !== null ? error : {};
  if (failure.code === 'ENOENT') {
    return new SystemError('unsupported', `${what} is not available on this PC.`, { cause: error });
  }
  if (failure.killed === true || failure.code === 'ETIMEDOUT') {
    return new SystemError('timeout', `${what} took too long.`, { cause: error });
  }
  const detail = firstLine(failure.stderr) ?? firstLine(failure.message);
  return new SystemError(
    'failed',
    detail === undefined ? `${what} failed.` : `${what} failed: ${detail}`,
    {
      cause: error,
    },
  );
}

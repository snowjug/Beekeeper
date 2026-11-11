import { win32 } from 'node:path';
import type { Logger } from '@shared/logger';
import { assertWindows, toSystemError, type ExecFileFn } from './exec';
import { isRecord } from './guards';
import { SystemError, type SystemErrorCode } from './types';

/** Helper scripts shipped in `<resources>/scripts`. */
export type PowerShellScript =
  | 'audio'
  | 'battery'
  | 'brightness'
  | 'close-windows'
  | 'recycle-bin'
  | 'sleep'
  | 'theme'
  | 'uwp-apps'
  | 'windows';

export type ScriptArgValue = string | number | boolean | undefined;
export type ScriptArgs = Readonly<Record<string, ScriptArgValue>>;

export interface PowerShellRunOptions {
  /** Kills PowerShell after this many ms. 0 disables the limit (used by sleep). Default 15 s. */
  timeoutMs?: number;
}

export interface PowerShellRunner {
  /** Runs `scripts/<script>.ps1` and resolves with the `data` of its JSON reply. */
  run(
    script: PowerShellScript,
    args?: ScriptArgs,
    options?: PowerShellRunOptions,
  ): Promise<unknown>;
}

export interface PowerShellRunnerOptions {
  exec: ExecFileFn;
  /** Absolute path of powershell.exe. */
  powershellPath: string;
  /** Folder holding the .ps1 files. */
  scriptsDir: string;
  /** Where scripts cache compiled helper assemblies. Empty/undefined: compile in memory every time. */
  cacheDir?: string;
  platform: NodeJS.Platform;
  logger: Logger;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const POWERSHELL_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'] as const;
/** Scripts that compile C# helpers and therefore take a cache directory. */
const CACHING_SCRIPTS: ReadonlySet<PowerShellScript> = new Set<PowerShellScript>([
  'audio',
  'close-windows',
  'theme',
  'windows',
]);
const ARGUMENT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ERROR_CODES: ReadonlySet<string> = new Set<SystemErrorCode>([
  'unsupported',
  'failed',
  'not-found',
  'timeout',
  'invalid-argument',
]);

/**
 * Turns typed values into `-Name value` pairs. Booleans become switches (omitted when false). Strings
 * may not start with "-" so a value can never be read as another parameter.
 */
export function buildScriptArgs(args: ScriptArgs): string[] {
  const argv: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    if (!ARGUMENT_NAME.test(name)) {
      throw new SystemError('invalid-argument', `Invalid script argument name "${name}".`);
    }
    if (value === undefined || value === false) continue;
    argv.push(`-${name}`);
    if (value === true) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new SystemError(
          'invalid-argument',
          `Script argument ${name} must be a finite number.`,
        );
      }
      argv.push(String(value));
      continue;
    }
    if (value.startsWith('-') || CONTROL_CHARS.test(value)) {
      throw new SystemError('invalid-argument', `Script argument ${name} has an unsafe value.`);
    }
    argv.push(value);
  }
  return argv;
}

function lastJsonLine(stdout: string): string | null {
  const lines = stdout
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));
  return lines.at(-1) ?? null;
}

/** Validates the `{ok, data}` / `{ok:false, code, message}` envelope printed by every script. */
export function parseScriptReply(script: string, stdout: string): unknown {
  const line = lastJsonLine(stdout);
  let reply: unknown;
  try {
    reply = line === null ? undefined : JSON.parse(line);
  } catch {
    reply = undefined;
  }
  if (!isRecord(reply) || typeof reply.ok !== 'boolean') {
    throw new SystemError('failed', `The "${script}" helper returned an unexpected reply.`);
  }
  if (reply.ok) return reply.data;
  const code =
    typeof reply.code === 'string' && ERROR_CODES.has(reply.code)
      ? (reply.code as SystemErrorCode)
      : 'failed';
  const message =
    typeof reply.message === 'string' && reply.message.length > 0
      ? reply.message
      : `The "${script}" helper failed.`;
  throw new SystemError(code, message);
}

export function createPowerShellRunner(options: PowerShellRunnerOptions): PowerShellRunner {
  const { exec, powershellPath, scriptsDir, cacheDir, platform, logger } = options;
  const now = options.now ?? Date.now;

  return {
    async run(script, args = {}, runOptions = {}) {
      assertWindows(platform);
      const scriptArgs =
        cacheDir !== undefined && cacheDir !== '' && CACHING_SCRIPTS.has(script)
          ? { ...args, CacheDir: cacheDir }
          : args;
      const argv = [
        ...POWERSHELL_FLAGS,
        '-File',
        win32.join(scriptsDir, `${script}.ps1`),
        ...buildScriptArgs(scriptArgs),
      ];
      const startedAt = now();
      let stdout: string;
      try {
        ({ stdout } = await exec(powershellPath, argv, {
          timeout: runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          windowsHide: true,
        }));
      } catch (error) {
        const failure = toSystemError(error, `The "${script}" helper`);
        logger.warn(`PowerShell script ${script} failed after ${now() - startedAt} ms`, failure);
        throw failure;
      }
      logger.debug(`PowerShell script ${script} finished in ${now() - startedAt} ms`);
      return parseScriptReply(script, stdout);
    },
  };
}

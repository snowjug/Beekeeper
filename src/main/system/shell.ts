import type { Logger } from '@shared/logger';
import {
  assertWindows,
  toSystemError,
  type ExecFileFn,
  type SpawnDetachedFn,
  type SystemPaths,
} from './exec';
import type { PowerShellRunner } from './powershell';
import { SystemError, type SettingsPage, type SystemApi } from './types';

export type ShellApi = Pick<
  SystemApi,
  'openSettingsPage' | 'lockWorkstation' | 'emptyRecycleBin' | 'power' | 'setDarkMode'
>;

export const SETTINGS_URIS: Readonly<Record<SettingsPage, string>> = {
  wifi: 'ms-settings:network-wifi',
  bluetooth: 'ms-settings:bluetooth',
  display: 'ms-settings:display',
  sound: 'ms-settings:sound',
};

const COMMAND_TIMEOUT_MS = 10_000;
const THEME_MODES: ReadonlySet<string> = new Set(['dark', 'light', 'toggle']);

export interface ShellApiOptions {
  runner: PowerShellRunner;
  exec: ExecFileFn;
  spawnDetached: SpawnDetachedFn;
  paths: SystemPaths;
  platform: NodeJS.Platform;
  logger: Logger;
}

/** Validates the reply of theme.ps1. */
export function parseTheme(data: unknown): 'dark' | 'light' {
  if (typeof data === 'object' && data !== null && 'mode' in data) {
    if (data.mode === 'dark' || data.mode === 'light') return data.mode;
  }
  throw new SystemError('failed', 'The theme helper returned an unexpected reply.');
}

/** Lock, settings pages, recycle bin, power and theme: small shell actions with fixed arguments. */
export function createShellApi(options: ShellApiOptions): ShellApi {
  const { runner, exec, spawnDetached, paths, platform, logger } = options;

  async function runProgram(file: string, args: readonly string[], what: string): Promise<void> {
    assertWindows(platform);
    try {
      await exec(file, args, { timeout: COMMAND_TIMEOUT_MS, windowsHide: true });
    } catch (error) {
      const failure = toSystemError(error, what);
      logger.warn(`${what} failed`, failure);
      throw failure;
    }
  }

  return {
    async openSettingsPage(page) {
      assertWindows(platform);
      const uri = SETTINGS_URIS[page] as string | undefined;
      if (uri === undefined) {
        throw new SystemError('invalid-argument', `Unknown settings page "${String(page)}".`);
      }
      try {
        await spawnDetached(paths.explorer, [uri]);
      } catch (error) {
        throw toSystemError(error, 'Opening Settings');
      }
    },

    async lockWorkstation() {
      await runProgram(paths.rundll32, ['user32.dll,LockWorkStation'], 'Locking the PC');
    },

    async emptyRecycleBin() {
      await runner.run('recycle-bin');
    },

    async power(action) {
      switch (action) {
        case 'shutdown':
          await runProgram(paths.shutdown, ['/s', '/t', '0'], 'Shutting down');
          return;
        case 'restart':
          await runProgram(paths.shutdown, ['/r', '/t', '0'], 'Restarting');
          return;
        case 'sleep':
          // SetSuspendState only returns after the PC woke up again, so no timeout applies.
          await runner.run('sleep', {}, { timeoutMs: 0 });
          return;
        default:
          throw new SystemError('invalid-argument', `Unknown power action "${String(action)}".`);
      }
    },

    async setDarkMode(mode) {
      if (!THEME_MODES.has(mode)) {
        throw new SystemError('invalid-argument', `Unknown theme mode "${String(mode)}".`);
      }
      return parseTheme(await runner.run('theme', { Mode: mode }));
    },
  };
}

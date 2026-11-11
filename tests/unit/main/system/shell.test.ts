import { describe, expect, it, vi } from 'vitest';
import { resolveSystemPaths } from '@main/system/exec';
import { SETTINGS_URIS, createShellApi, parseTheme } from '@main/system/shell';
import { SystemError, type SettingsPage } from '@main/system/types';
import { silentLogger } from '@shared/logger';
import { childProcessError, fakeExec, fakeRunner } from './support';

const PATHS = resolveSystemPaths({ SystemRoot: 'C:\\Windows' });

function setup(
  options: {
    exec?: Parameters<typeof fakeExec>[0];
    runner?: Parameters<typeof fakeRunner>[0];
    platform?: NodeJS.Platform;
  } = {},
) {
  const { exec, calls: execCalls } = fakeExec(options.exec);
  const { runner, calls: runnerCalls } = fakeRunner(options.runner ?? (() => null));
  const spawnDetached = vi.fn(() => Promise.resolve());
  const warn = vi.fn();
  const api = createShellApi({
    runner,
    exec,
    spawnDetached,
    paths: PATHS,
    platform: options.platform ?? 'win32',
    logger: { ...silentLogger, warn },
  });
  return { api, execCalls, runnerCalls, spawnDetached, warn };
}

describe('openSettingsPage', () => {
  it.each([
    ['wifi', 'ms-settings:network-wifi'],
    ['bluetooth', 'ms-settings:bluetooth'],
    ['display', 'ms-settings:display'],
    ['sound', 'ms-settings:sound'],
  ] as const)('opens %s through Explorer as %s', async (page, uri) => {
    const { api, spawnDetached } = setup();
    await api.openSettingsPage(page);
    expect(SETTINGS_URIS[page]).toBe(uri);
    expect(spawnDetached).toHaveBeenCalledExactlyOnceWith(PATHS.explorer, [uri]);
  });

  it('rejects unknown pages without starting anything', async () => {
    const { api, spawnDetached } = setup();
    await expect(api.openSettingsPage('network' as SettingsPage)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('maps a failing launch and refuses other platforms', async () => {
    const { exec } = fakeExec();
    const failing = createShellApi({
      runner: fakeRunner(() => null).runner,
      exec,
      spawnDetached: () => Promise.reject(childProcessError({ code: 'ENOENT' })),
      paths: PATHS,
      platform: 'win32',
      logger: silentLogger,
    });
    await expect(failing.openSettingsPage('wifi')).rejects.toMatchObject({ code: 'unsupported' });

    const { api } = setup({ platform: 'linux' });
    await expect(api.openSettingsPage('wifi')).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('lockWorkstation', () => {
  it('runs rundll32 with the LockWorkStation entry point', async () => {
    const { api, execCalls } = setup();
    await api.lockWorkstation();
    expect(execCalls).toEqual([
      {
        file: PATHS.rundll32,
        args: ['user32.dll,LockWorkStation'],
        options: { timeout: 10_000, windowsHide: true },
      },
    ]);
  });

  it('maps failures and logs them', async () => {
    const { api, warn } = setup({
      exec: () => Promise.reject(childProcessError({ code: 1, stderr: 'denied' })),
    });
    await expect(api.lockWorkstation()).rejects.toMatchObject({
      code: 'failed',
      message: 'Locking the PC failed: denied',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses other platforms', async () => {
    const { api, execCalls } = setup({ platform: 'darwin' });
    await expect(api.lockWorkstation()).rejects.toMatchObject({ code: 'unsupported' });
    expect(execCalls).toEqual([]);
  });
});

describe('emptyRecycleBin', () => {
  it('runs recycle-bin.ps1', async () => {
    const { api, runnerCalls } = setup({ runner: () => ({ items: 3 }) });
    await expect(api.emptyRecycleBin()).resolves.toBeUndefined();
    expect(runnerCalls).toEqual([{ script: 'recycle-bin', args: {}, options: {} }]);
  });

  it('passes failures on', async () => {
    const { api } = setup({
      runner: () => {
        throw new SystemError('failed', 'Recycle bin is locked.');
      },
    });
    await expect(api.emptyRecycleBin()).rejects.toMatchObject({
      message: 'Recycle bin is locked.',
    });
  });
});

describe('power', () => {
  it('shuts down and restarts immediately with fixed arguments', async () => {
    const { api, execCalls } = setup();
    await api.power('shutdown');
    await api.power('restart');
    expect(execCalls.map((call) => [call.file, call.args])).toEqual([
      [PATHS.shutdown, ['/s', '/t', '0']],
      [PATHS.shutdown, ['/r', '/t', '0']],
    ]);
  });

  it('sleeps through the sleep script without a timeout, because it returns after resume', async () => {
    const { api, runnerCalls, execCalls } = setup();
    await api.power('sleep');
    expect(runnerCalls).toEqual([{ script: 'sleep', args: {}, options: { timeoutMs: 0 } }]);
    expect(execCalls).toEqual([]);
  });

  it('rejects unknown actions without doing anything', async () => {
    const { api, execCalls, runnerCalls } = setup();
    await expect(api.power('hibernate' as 'sleep')).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(execCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
  });

  it('maps a failing shutdown and refuses other platforms', async () => {
    const { api } = setup({ exec: () => Promise.reject(childProcessError({ killed: true })) });
    await expect(api.power('shutdown')).rejects.toMatchObject({ code: 'timeout' });

    const other = setup({ platform: 'linux' });
    await expect(other.api.power('restart')).rejects.toMatchObject({ code: 'unsupported' });
    expect(other.execCalls).toEqual([]);
  });
});

describe('setDarkMode', () => {
  it.each(['dark', 'light', 'toggle'] as const)(
    'asks theme.ps1 for %s and returns the active theme',
    async (mode) => {
      const { api, runnerCalls } = setup({ runner: () => ({ mode: 'dark' }) });
      expect(await api.setDarkMode(mode)).toBe('dark');
      expect(runnerCalls).toEqual([{ script: 'theme', args: { Mode: mode }, options: {} }]);
    },
  );

  it('rejects unknown modes and unexpected replies', async () => {
    const { api, runnerCalls } = setup({ runner: () => ({ mode: 'sepia' }) });
    await expect(api.setDarkMode('sepia' as 'dark')).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(runnerCalls).toEqual([]);
    await expect(api.setDarkMode('dark')).rejects.toMatchObject({ code: 'failed' });
  });

  it('parses the helper reply strictly', () => {
    expect(parseTheme({ mode: 'light' })).toBe('light');
    for (const reply of [null, undefined, {}, { mode: 1 }, { mode: 'DARK' }, 'dark']) {
      expect(() => parseTheme(reply)).toThrowError(/unexpected reply/);
    }
  });
});

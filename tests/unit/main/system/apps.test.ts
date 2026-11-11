import { describe, expect, it, vi, type Mock } from 'vitest';
import { createAppsApi } from '@main/system/apps';
import { resolveSystemPaths, type SpawnDetachedFn } from '@main/system/exec';
import type { InstalledApp } from '@main/system/types';
import { silentLogger, type Logger } from '@shared/logger';
import {
  childProcessError,
  createMemoryFs,
  fakeExec,
  fakeRunner,
  type ExecCall,
  type RunnerCall,
} from './support';

const APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
const MENU = `${APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`;
const ENV = { APPDATA, SystemRoot: 'C:\\Windows' };
const PATHS = resolveSystemPaths(ENV);
const SELF = 4242;

const WINDOWS = [
  { pid: 100, name: 'notepad', title: 'Untitled - Notepad' },
  { pid: 200, name: 'chrome', title: 'New Tab - Google Chrome' },
  { pid: 900, name: 'explorer', title: 'Documents' },
  { pid: SELF, name: 'electron', title: 'Beekeeper' },
  { pid: 4, name: 'svchost', title: 'Windows Service Host' },
];

interface Options {
  files?: readonly string[];
  uwp?: unknown;
  windows?: unknown;
  closeReply?: unknown;
  taskkill?: (pid: string) => void;
  /** Replaces the default (successful) answer of taskkill. */
  execHandler?: (call: ExecCall) => Promise<{ stdout: string; stderr: string }>;
  spawnDetached?: Mock<SpawnDetachedFn>;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

function setup(options: Options = {}) {
  const files = options.files ?? [
    `${MENU}\\Spotify.lnk`,
    `${MENU}\\Visual Studio Code\\Visual Studio Code.lnk`,
    `${MENU}\\Visual Studio Installer.lnk`,
  ];
  const { runner, calls } = fakeRunner((call: RunnerCall) => {
    switch (call.script) {
      case 'uwp-apps':
        return (
          options.uwp ?? [{ name: 'Photos', appId: 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App' }]
        );
      case 'windows':
        return options.windows ?? WINDOWS;
      case 'close-windows':
        return options.closeReply ?? { remaining: [] };
      default:
        throw new Error(`unexpected script ${call.script}`);
    }
  });
  const { exec, calls: execCalls } = fakeExec((call) => {
    options.taskkill?.(call.args[1] ?? '');
    return options.execHandler?.(call) ?? { stdout: '', stderr: '' };
  });
  const spawnDetached = options.spawnDetached ?? vi.fn<SpawnDetachedFn>(() => Promise.resolve());
  const fs = createMemoryFs(files);
  const api = createAppsApi({
    runner,
    exec,
    spawnDetached,
    fs,
    env: ENV,
    paths: PATHS,
    logger: options.logger ?? silentLogger,
    now: () => 0,
    sleep: options.sleep ?? (() => Promise.resolve()),
    selfPid: SELF,
  });
  return { api, calls, execCalls, spawnDetached, fs };
}

describe('findApps', () => {
  it('returns strong matches without waiting for the slow packaged-app list', async () => {
    const never = new Promise<unknown>(() => undefined);
    const sleep = vi.fn(() => new Promise<void>(() => undefined));
    const { api } = setup({ uwp: never, sleep });

    const matches = await api.findApps('notepad');
    expect(matches[0]).toMatchObject({ app: { name: 'Notepad', kind: 'builtin' }, score: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits for the packaged apps when the fast index has no strong match', async () => {
    const sleep = vi.fn(() => new Promise<void>(() => undefined));
    const { api, calls } = setup({ sleep });
    const matches = await api.findApps('photos');
    expect(matches[0]).toMatchObject({
      app: { name: 'Photos', kind: 'uwp', target: 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App' },
      score: 1,
    });
    expect(calls.filter((call) => call.script === 'uwp-apps')).toHaveLength(1);
  });

  it('gives up on a packaged-app list that never arrives', async () => {
    const never = new Promise<unknown>(() => undefined);
    const sleep = vi.fn(() => Promise.resolve());
    const { api } = setup({ uwp: never, sleep });
    const matches = await api.findApps('photos');
    expect(matches).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(6000);
  });

  it('understands aliases and returns several candidates best first', async () => {
    const { api } = setup();
    expect((await api.findApps('vs code'))[0]?.app.name).toBe('Visual Studio Code');
    const candidates = await api.findApps('visual studio', 2);
    expect(candidates.map((match) => match.app.name)).toEqual([
      'Visual Studio Code',
      'Visual Studio Installer',
    ]);
  });

  it('returns nothing for an empty or unknown name', async () => {
    const { api } = setup();
    expect(await api.findApps('')).toEqual([]);
    expect(await api.findApps('   ')).toEqual([]);
    expect(await api.findApps('zzzzqqqq')).toEqual([]);
  });

  it('refreshApps scans again and counts the apps', async () => {
    const { api } = setup();
    expect(await api.refreshApps()).toBeGreaterThan(20);
  });
});

describe('launchApp', () => {
  it('opens a Start menu shortcut through Explorer', async () => {
    const { api, spawnDetached } = setup();
    const [spotify] = await api.findApps('spotify');
    await api.launchApp(spotify?.app as InstalledApp);
    expect(spawnDetached).toHaveBeenCalledWith(PATHS.explorer, [`${MENU}\\Spotify.lnk`]);
  });

  it('opens a packaged app by its AppUserModelID', async () => {
    const { api, spawnDetached } = setup();
    const [photos] = await api.findApps('photos');
    await api.launchApp(photos?.app as InstalledApp);
    expect(spawnDetached).toHaveBeenCalledWith(PATHS.explorer, [
      'shell:AppsFolder\\Microsoft.Windows.Photos_8wekyb3d8bbwe!App',
    ]);
  });

  it('starts built-in programs with `cmd /c start` in a hidden shell, and URIs through Explorer', async () => {
    const { api, spawnDetached } = setup();
    const [notepad] = await api.findApps('notepad');
    await api.launchApp(notepad?.app as InstalledApp);
    expect(spawnDetached).toHaveBeenLastCalledWith(
      PATHS.cmd,
      ['/d', '/c', 'start', '', 'notepad.exe'],
      {
        hidden: true,
      },
    );

    const [settings] = await api.findApps('settings');
    await api.launchApp(settings?.app as InstalledApp);
    expect(spawnDetached).toHaveBeenLastCalledWith(PATHS.explorer, ['ms-settings:']);
  });

  it('refuses anything that did not come from the index', async () => {
    const { api, spawnDetached } = setup();
    await api.findApps('spotify');
    for (const evil of [
      { name: 'Evil', key: 'evil', kind: 'shortcut', target: 'C:\\Windows\\System32\\cmd.exe' },
      { name: 'Evil', key: 'evil', kind: 'builtin', target: 'cmd.exe /c calc' },
      { name: 'Evil', key: 'evil', kind: 'uwp', target: 'a&calc' },
      { name: 'Spotify', key: 'spotify', kind: 'builtin', target: `${MENU}\\Spotify.lnk` },
    ] as const) {
      await expect(api.launchApp(evil)).rejects.toMatchObject({ code: 'not-found' });
    }
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('reports a shortcut that was removed since the last scan', async () => {
    const { api, spawnDetached, fs } = setup();
    const [spotify] = await api.findApps('spotify');
    fs.files.clear();
    await expect(api.launchApp(spotify?.app as InstalledApp)).rejects.toMatchObject({
      code: 'not-found',
      message: 'The shortcut for Spotify no longer exists.',
    });
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('maps a program that cannot be started to a SystemError', async () => {
    const spawnDetached = vi.fn<SpawnDetachedFn>(() =>
      Promise.reject(childProcessError({ code: 'ENOENT' })),
    );
    const { api } = setup({ spawnDetached });
    const [notepad] = await api.findApps('notepad');
    await expect(api.launchApp(notepad?.app as InstalledApp)).rejects.toMatchObject({
      code: 'unsupported',
      message: 'Starting Notepad is not available on this PC.',
    });
  });
});

describe('closeApp', () => {
  it('closes the windows of an app gracefully and reports success', async () => {
    const { api, calls } = setup();
    const result = await api.closeApp('notepad');

    expect(result).toEqual({ status: 'closed', processes: [WINDOWS[0]] });
    const close = calls.find((call) => call.script === 'close-windows');
    expect(close).toEqual({
      script: 'close-windows',
      args: { Targets: '100:notepad', WaitMs: 3000 },
      options: { timeoutMs: 20_000 },
    });
  });

  it('asks for force when windows stay open after the polite request', async () => {
    const { api } = setup({ closeReply: { remaining: [200] } });
    expect(await api.closeApp('google chrome')).toEqual({
      status: 'needs-force',
      processes: [WINDOWS[1]],
    });
  });

  it('says the app is not running without touching anything', async () => {
    const { api, calls } = setup();
    expect(await api.closeApp('discord')).toEqual({ status: 'not-running', processes: [] });
    expect(calls.some((call) => call.script === 'close-windows')).toBe(false);
  });

  it('refuses protected processes and Beekeeper itself', async () => {
    const { api, calls, execCalls } = setup();
    await expect(api.closeApp('svchost')).rejects.toMatchObject({
      code: 'unsupported',
      message: "Svchost is part of Windows, so I won't close it.",
    });
    await expect(api.closeApp('beekeeper')).rejects.toMatchObject({ code: 'unsupported' });
    expect(calls.some((call) => call.script === 'close-windows')).toBe(false);
    expect(execCalls).toEqual([]);
  });

  it.each(['', '   ', 'x'.repeat(101)])('rejects the query %j', async (query) => {
    const { api } = setup();
    await expect(api.closeApp(query)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects an unexpected reply from the helper', async () => {
    const { api } = setup({ closeReply: { remaining: 'all' } });
    await expect(api.closeApp('notepad')).rejects.toMatchObject({ code: 'failed' });
  });

  it('can close File Explorer windows politely', async () => {
    const { api } = setup();
    expect(await api.closeApp('file explorer')).toMatchObject({ status: 'closed' });
  });

  describe('with force', () => {
    it('ends the matching processes by pid only, without the polite round', async () => {
      const killed: string[] = [];
      const { api, calls, execCalls } = setup({ taskkill: (pid) => killed.push(pid) });
      const result = await api.closeApp('notepad', { force: true });

      expect(result).toEqual({ status: 'closed', processes: [WINDOWS[0]] });
      expect(execCalls).toEqual([
        { file: PATHS.taskkill, args: ['/PID', '100', '/F'], options: { timeout: 10_000 } },
      ]);
      expect(killed).toEqual(['100']);
      expect(calls.some((call) => call.script === 'close-windows')).toBe(false);
    });

    it('treats a process that already exited as closed', async () => {
      const { api, execCalls } = setup({
        execHandler: () => Promise.reject(childProcessError({ code: 128 })),
      });
      expect(await api.closeApp('notepad', { force: true })).toMatchObject({ status: 'closed' });
      expect(execCalls).toHaveLength(1);
    });

    it('reports processes Windows refused to end', async () => {
      const warn = vi.fn();
      const { api } = setup({
        execHandler: () =>
          Promise.reject(childProcessError({ code: 1, stderr: 'Access is denied.' })),
        logger: { ...silentLogger, warn },
      });
      await expect(api.closeApp('notepad', { force: true })).rejects.toMatchObject({
        code: 'failed',
        message: 'Windows would not end notepad.',
      });
      expect(warn).toHaveBeenCalled();
    });

    it('never terminates the shell', async () => {
      const { api, execCalls } = setup();
      await expect(api.closeApp('explorer', { force: true })).rejects.toMatchObject({
        code: 'unsupported',
        message: "File Explorer is part of Windows, so it can't be force closed.",
      });
      expect(execCalls).toEqual([]);
    });
  });
});

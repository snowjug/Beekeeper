import { describe, expect, it, vi } from 'vitest';
import {
  APP_INDEX_TTL_MS,
  AppIndex,
  isNoiseName,
  mergeApps,
  parseStartApps,
  scanStartMenu,
  startMenuRoots,
} from '@main/system/appIndex';
import { builtinApps, isUriTarget } from '@main/system/builtinApps';
import type { SystemFs } from '@main/system/systemFs';
import { SystemError } from '@main/system/types';
import { silentLogger } from '@shared/logger';
import { app, createMemoryFs, fakeRunner } from './support';

const APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
const PROGRAM_DATA = 'C:\\ProgramData';
const USER_MENU = `${APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`;
const COMMON_MENU = `${PROGRAM_DATA}\\Microsoft\\Windows\\Start Menu\\Programs`;
const ENV = { APPDATA, ProgramData: PROGRAM_DATA, LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };

const SHORTCUTS = [
  `${USER_MENU}\\Spotify.lnk`,
  `${USER_MENU}\\Visual Studio Code\\Visual Studio Code.lnk`,
  `${USER_MENU}\\Google Chrome.lnk`,
  `${COMMON_MENU}\\Google Chrome.lnk`,
  `${COMMON_MENU}\\Accessories\\Notepad.lnk`,
  `${COMMON_MENU}\\Foo\\Foo.lnk`,
  `${COMMON_MENU}\\Foo\\Uninstall Foo.lnk`,
  `${COMMON_MENU}\\Foo\\Foo Help.lnk`,
  `${COMMON_MENU}\\Foo\\Foo Readme.lnk`,
  `${COMMON_MENU}\\Foo\\Foo Website.lnk`,
  `${COMMON_MENU}\\Foo\\Foo.url`,
  `${COMMON_MENU}\\Foo\\desktop.ini`,
  `${COMMON_MENU}\\Zeta\\Alpha.lnk`,
];

describe('isNoiseName', () => {
  it.each([
    'Uninstall Foo',
    'Foo Uninstaller',
    'Foo Help',
    'Help',
    'Foo Readme',
    'Read Me',
    'Foo Documentation',
    'User Guide',
    'Python 3.12 Manuals',
    'Foo Website',
    'Foo Web Site',
    'Release Notes',
    'License Agreement',
    'EULA',
    'Changelog',
    'Remove Foo',
  ])('treats %j as noise', (name) => {
    expect(isNoiseName(name)).toBe(true);
  });

  it.each([
    'Notepad',
    'Google Docs',
    'Visual Studio Code',
    'Quick Assist',
    'Malicious Software Removal Tool',
    'Helper',
  ])('keeps %j', (name) => {
    expect(isNoiseName(name)).toBe(false);
  });
});

describe('startMenuRoots', () => {
  it('lists the per-user folder before the all-users folder', () => {
    expect(startMenuRoots(ENV)).toEqual([USER_MENU, COMMON_MENU]);
  });

  it('skips variables that are not set', () => {
    expect(startMenuRoots({ APPDATA })).toEqual([USER_MENU]);
    expect(startMenuRoots({ ProgramData: '' })).toEqual([]);
    expect(startMenuRoots({})).toEqual([]);
  });
});

describe('scanStartMenu', () => {
  it('collects .lnk shortcuts recursively, user folder first, skipping noise and other files', async () => {
    const fs = createMemoryFs(SHORTCUTS);
    const found = await scanStartMenu([USER_MENU, COMMON_MENU], fs, silentLogger);
    expect(found.map((shortcut) => shortcut.name)).toEqual([
      'Google Chrome',
      'Spotify',
      'Visual Studio Code',
      'Notepad',
      'Foo',
      'Google Chrome',
      'Alpha',
    ]);
    expect(found[0]?.path).toBe(`${USER_MENU}\\Google Chrome.lnk`);
    expect(found.every((shortcut) => shortcut.path.toLowerCase().endsWith('.lnk'))).toBe(true);
  });

  it('survives unreadable and missing folders', async () => {
    const fs = createMemoryFs(SHORTCUTS, { unreadable: [`${COMMON_MENU}\\Foo`, COMMON_MENU] });
    const debug = vi.fn();
    const found = await scanStartMenu([USER_MENU, COMMON_MENU, 'C:\\Missing'], fs, {
      ...silentLogger,
      debug,
    });
    expect(found.map((shortcut) => shortcut.name)).toEqual([
      'Google Chrome',
      'Spotify',
      'Visual Studio Code',
    ]);
    expect(debug).toHaveBeenCalled();
  });

  it('does not descend beyond a sane depth', async () => {
    const deep = `${USER_MENU}\\a\\b\\c\\d\\e\\f\\g`;
    const fs = createMemoryFs([`${deep}\\TooDeep.lnk`, `${USER_MENU}\\a\\b\\c\\d\\e\\f\\Deep.lnk`]);
    const found = await scanStartMenu([USER_MENU], fs, silentLogger);
    expect(found.map((shortcut) => shortcut.name)).toEqual(['Deep']);
  });

  it('returns nothing without roots', async () => {
    expect(await scanStartMenu([], createMemoryFs(), silentLogger)).toEqual([]);
  });
});

describe('parseStartApps', () => {
  it('keeps packaged apps and apps with a plain AppUserModelID', () => {
    expect(
      parseStartApps([
        { name: 'Calculator', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
        { name: 'Google Chrome', appId: 'Chrome' },
        { name: ' Brave ', appId: 'Brave.M4NS5E2WPAS3725P6XJVK52CDM' },
      ]),
    ).toEqual([
      { name: 'Calculator', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
      { name: 'Google Chrome', appId: 'Chrome' },
      { name: 'Brave', appId: 'Brave.M4NS5E2WPAS3725P6XJVK52CDM' },
    ]);
  });

  it('drops paths, GUID folders, unsafe ids, noise and malformed entries', () => {
    expect(
      parseStartApps([
        { name: 'Docs', appId: 'C:\\Users\\me\\Doc\\index.html' },
        { name: 'Word', appId: '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}\\Office\\WINWORD.EXE' },
        { name: 'Evil', appId: 'a b' },
        { name: 'Evil2', appId: 'a&calc' },
        { name: 'Evil3', appId: '..\\x!y' },
        { name: 'Uninstall Foo', appId: 'Foo.Uninstall' },
        { name: '', appId: 'Foo.Bar' },
        { name: 'No id' },
        { appId: 'No.Name' },
        { name: 5, appId: 'Num' },
        null,
        'text',
      ]),
    ).toEqual([]);
  });

  it('copes with non-array replies', () => {
    expect(parseStartApps(null)).toEqual([]);
    expect(parseStartApps({ name: 'x' })).toEqual([]);
    expect(parseStartApps('[]')).toEqual([]);
  });
});

describe('mergeApps', () => {
  it('keeps one entry per name: built-ins before shortcuts before packaged apps', () => {
    const builtin = app('Notepad', 'builtin', 'notepad.exe');
    const shortcut = app('Notepad', 'shortcut');
    const uwp = app('Notepad', 'uwp', 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App');
    const photos = app('Photos', 'uwp', 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App');
    expect(mergeApps([uwp, photos], [shortcut], [builtin])).toEqual([uwp, photos]);
    expect(mergeApps([builtin], [shortcut], [uwp, photos])).toEqual([builtin, photos]);
  });

  it('ignores entries without a usable name', () => {
    expect(mergeApps([{ name: '***', key: '', kind: 'shortcut', target: 'x.lnk' }])).toEqual([]);
  });
});

describe('builtinApps', () => {
  it('lists the programs every Windows install ships with, but not apps that may be missing', () => {
    const names = builtinApps().map((builtin) => builtin.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Notepad',
        'Calculator',
        'File Explorer',
        'Task Manager',
        'Settings',
      ]),
    );
    expect(names).not.toContain('Windows Terminal');
    expect(new Set(names).size).toBe(names.length);
  });

  it('only contains plain executable names and URI schemes, never paths or arguments', () => {
    const builtins = builtinApps();
    expect(builtins.every((builtin) => builtin.kind === 'builtin')).toBe(true);
    for (const builtin of builtins) {
      expect(builtin.target, builtin.name).toMatch(/^[a-z0-9.-]+\.(?:exe|msc)$|^[a-z-]+:$/);
    }
    expect(isUriTarget('ms-settings:')).toBe(true);
    expect(isUriTarget('notepad.exe')).toBe(false);
    expect(isUriTarget('ms-settings:network')).toBe(false);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const UWP_REPLY = [
  { name: 'Photos', appId: 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App' },
  { name: 'Spotify', appId: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' },
];

function createIndex(
  options: {
    uwp?: Promise<unknown>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    fs?: SystemFs;
  } = {},
) {
  const { runner, calls } = fakeRunner(() => options.uwp ?? Promise.resolve(UWP_REPLY));
  const warn = vi.fn();
  const index = new AppIndex({
    runner,
    fs: options.fs ?? createMemoryFs(SHORTCUTS),
    env: ENV,
    logger: { ...silentLogger, warn },
    now: options.now ?? (() => 0),
    sleep: options.sleep ?? (() => Promise.resolve()),
  });
  return { index, calls, warn };
}

const names = (apps: readonly { name: string }[]): string[] =>
  apps.map((candidate) => candidate.name);

describe('AppIndex', () => {
  it('is usable as soon as shortcuts and built-ins are scanned, while packaged apps still load', async () => {
    const uwp = deferred<unknown>();
    const { index, calls } = createIndex({ uwp: uwp.promise });

    const apps = await index.snapshot();
    expect(names(apps)).toEqual(
      expect.arrayContaining(['Notepad', 'Spotify', 'Visual Studio Code', 'Google Chrome']),
    );
    expect(names(apps)).not.toContain('Photos');
    expect(index.isUwpLoaded).toBe(false);
    expect(calls).toEqual([{ script: 'uwp-apps', args: {}, options: { timeoutMs: 30_000 } }]);

    uwp.resolve(UWP_REPLY);
    await index.waitForUwp(5000);
    expect(index.isUwpLoaded).toBe(true);
    const updated = await index.snapshot();
    expect(names(updated)).toContain('Photos');
    // The shortcut and the packaged Spotify are one entry: the shortcut wins.
    expect(updated.filter((candidate) => candidate.name === 'Spotify')).toHaveLength(1);
    expect(updated.find((candidate) => candidate.name === 'Spotify')?.kind).toBe('shortcut');
  });

  it('puts built-ins before same-named shortcuts and de-duplicates the two Start menu folders', async () => {
    const { index } = createIndex();
    const apps = await index.snapshot();
    expect(apps.find((candidate) => candidate.name === 'Notepad')?.kind).toBe('builtin');
    const chrome = apps.filter((candidate) => candidate.name === 'Google Chrome');
    expect(chrome).toHaveLength(1);
    expect(chrome[0]?.target).toBe(`${USER_MENU}\\Google Chrome.lnk`);
  });

  it('stops waiting for packaged apps after the timeout', async () => {
    const never = new Promise<unknown>(() => undefined);
    const sleep = vi.fn(() => Promise.resolve());
    const { index } = createIndex({ uwp: never, sleep });
    await index.snapshot();
    await index.waitForUwp(1234);
    expect(sleep).toHaveBeenCalledWith(1234);
    expect(index.isUwpLoaded).toBe(false);
  });

  it('keeps working without packaged apps when listing them fails', async () => {
    const { index, warn } = createIndex({
      uwp: Promise.reject(new SystemError('timeout', 'too slow')),
    });
    const apps = await index.snapshot();
    await index.waitForUwp(1000);
    expect(index.isUwpLoaded).toBe(true);
    expect(names(apps)).toContain('Spotify');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not rescan within the TTL, then refreshes in the background while serving the old list', async () => {
    let clock = 0;
    const replies = [[], UWP_REPLY];
    const { runner, calls } = fakeRunner(() => replies.shift() ?? []);
    const index = new AppIndex({
      runner,
      fs: createMemoryFs(SHORTCUTS),
      env: ENV,
      logger: silentLogger,
      now: () => clock,
      sleep: () => Promise.resolve(),
    });

    await index.snapshot();
    await index.waitForUwp(1000);
    clock = APP_INDEX_TTL_MS - 1;
    await index.snapshot();
    expect(calls).toHaveLength(1);

    clock = APP_INDEX_TTL_MS + 1;
    const stale = await index.snapshot();
    expect(names(stale)).not.toContain('Photos');
    expect(calls).toHaveLength(2);
    await index.refresh();
    expect(names(await index.snapshot())).toContain('Photos');
    // The refresh finished at the new time: no further scan right away.
    await index.snapshot();
    expect(calls).toHaveLength(2);
  });

  it('refresh() joins a scan that is already running and returns the new list', async () => {
    const { index, calls } = createIndex();
    const first = index.refresh();
    const second = index.refresh();
    expect(names(await first)).toContain('Photos');
    expect(await second).toBe(await first);
    expect(calls).toHaveLength(1);
  });

  it('keeps the built-in apps when the Start menu scan itself fails', async () => {
    const broken = {
      ...createMemoryFs(SHORTCUTS),
      readdir: () => Promise.resolve(undefined as never),
    };
    const { index, warn } = createIndex({ fs: broken });
    const apps = await index.snapshot();
    expect(names(apps)).toContain('Notepad');
    expect(apps.some((candidate) => candidate.kind === 'shortcut')).toBe(false);
    expect(warn).toHaveBeenCalledWith('Scanning the Start menu failed', expect.any(Error));
  });

  it('knows which apps it may launch', async () => {
    const { index } = createIndex();
    const apps = await index.snapshot();
    const notepad = apps.find((candidate) => candidate.name === 'Notepad');
    expect(notepad && index.contains(notepad)).toBe(true);
    expect(index.contains({ ...app('Evil', 'shortcut', 'C:\\Windows\\System32\\evil.exe') })).toBe(
      false,
    );
    expect(
      index.contains({ name: 'Notepad', key: 'notepad', kind: 'shortcut', target: 'notepad.exe' }),
    ).toBe(false);
  });
});

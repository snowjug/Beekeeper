import { describe, expect, it, vi } from 'vitest';
import { createSystemApi } from '@main/system';
import type { HostInfo } from '@main/system/sysinfo';
import { silentLogger } from '@shared/logger';
import { createMemoryFs, fakeExec, successReply } from './support';

const ENV = {
  SystemRoot: 'C:\\Windows',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
};
const RESOURCES = 'C:\\Program Files\\Beekeeper\\resources';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function scriptOf(args: readonly string[]): string {
  const file = args[args.indexOf('-File') + 1] ?? '';
  return file.slice(file.lastIndexOf('\\') + 1);
}

function create(options: Partial<Parameters<typeof createSystemApi>[0]> = {}) {
  const { exec, calls } = fakeExec((call) => {
    switch (scriptOf(call.args)) {
      case 'audio.ps1':
        return { stdout: successReply({ percent: 37, muted: false }), stderr: '' };
      case 'uwp-apps.ps1':
        return {
          stdout: successReply([
            { name: 'Photos', appId: 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App' },
          ]),
          stderr: '',
        };
      default:
        return { stdout: successReply(null), stderr: '' };
    }
  });
  const capture = vi.fn(() =>
    Promise.resolve({ png: Buffer.from([1, 2, 3]), width: 800, height: 600 }),
  );
  const api = createSystemApi({
    resourcesDir: RESOURCES,
    picturesDir: 'C:\\Users\\me\\Pictures\\Beekeeper',
    capture,
    logger: silentLogger,
    exec,
    env: ENV,
    platform: 'win32',
    fs: createMemoryFs(),
    spawnDetached: () => Promise.resolve(),
    now: () => new Date(2026, 10, 10, 9, 8, 7).getTime(),
    sleep: () => Promise.resolve(),
    selfPid: 1,
    ...options,
  });
  return { api, calls, capture };
}

describe('createSystemApi', () => {
  it('runs helper scripts from the resources folder through the system PowerShell', async () => {
    const { api, calls } = create();
    expect(await api.getVolume()).toEqual({ percent: 37, muted: false });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe(POWERSHELL);
    expect(calls[0]?.args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      `${RESOURCES}\\scripts\\audio.ps1`,
      '-Action',
      'get',
      '-CacheDir',
      'C:\\Users\\me\\AppData\\Local\\Beekeeper\\cache',
    ]);
  });

  it('lets the caller choose the cache folder', async () => {
    const { api, calls } = create({ cacheDir: 'D:\\cache' });
    await api.getVolume();
    expect(calls[0]?.args.slice(-2)).toEqual(['-CacheDir', 'D:\\cache']);
  });

  it('compiles in memory when there is nowhere to cache', async () => {
    const { api, calls } = create({ env: { SystemRoot: 'C:\\Windows' } });
    await api.getVolume();
    expect(calls[0]?.args).not.toContain('-CacheDir');
  });

  it('saves screenshots through the injected capture', async () => {
    const { api, capture } = create();
    const shot = await api.takeScreenshot();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(shot).toEqual({
      path: 'C:\\Users\\me\\Pictures\\Beekeeper\\Screenshot 2026-11-10 09-08-07.png',
      width: 800,
      height: 600,
    });
  });

  it('reports system information from the injected host', async () => {
    const host: HostInfo = {
      cpus: () => [{ model: 'Test CPU', times: { user: 1, nice: 0, sys: 0, idle: 1, irq: 0 } }],
      totalMemory: () => 1000,
      freeMemory: () => 250,
      uptimeSeconds: () => 90,
      osRelease: () => '10.0.22631',
      osVersion: () => 'Windows 11 Pro',
      statfs: () => Promise.resolve({ bsize: 1, blocks: 100, bavail: 10 }),
    };
    const info = await create({ host }).api.getSystemInfo();
    expect(info.os).toBe('Windows 11 Pro (build 22631)');
    expect(info.memory.usagePercent).toBe(75);
    expect(info.disk.usagePercent).toBe(90);
    expect(info.uptimeSeconds).toBe(90);
  });

  it('waits for real time between the two CPU samples by default', async () => {
    const host: HostInfo = {
      cpus: () => [{ model: 'Test CPU', times: { user: 1, nice: 0, sys: 0, idle: 1, irq: 0 } }],
      totalMemory: () => 1000,
      freeMemory: () => 250,
      uptimeSeconds: () => 90,
      osRelease: () => '10.0.22631',
      osVersion: () => 'Windows 11 Pro',
      statfs: () => Promise.resolve({ bsize: 1, blocks: 100, bavail: 10 }),
    };
    const startedAt = Date.now();
    await create({ host, sleep: undefined }).api.getSystemInfo();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(350);
  });

  it('indexes apps on request and lets callers launch only what it found', async () => {
    const spawnDetached = vi.fn(() => Promise.resolve());
    const fs = createMemoryFs([
      'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Spotify.lnk',
    ]);
    const { api } = create({ fs, spawnDetached });

    expect(await api.refreshApps()).toBeGreaterThan(10);
    const [spotify] = await api.findApps('spotify');
    expect(spotify?.app).toMatchObject({ kind: 'shortcut' });
    await api.launchApp(spotify!.app);
    expect(spawnDetached).toHaveBeenCalledWith('C:\\Windows\\explorer.exe', [spotify!.app.target]);

    const [photos] = await api.findApps('photos');
    expect(photos?.app).toMatchObject({ kind: 'uwp', name: 'Photos' });
  });

  it('does nothing on other platforms and says why', async () => {
    const { api, calls } = create({ platform: 'linux' });
    await expect(api.getVolume()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(api.getBattery()).rejects.toMatchObject({ code: 'unsupported' });
    await expect(api.lockWorkstation()).rejects.toMatchObject({ code: 'unsupported' });
    expect(calls).toEqual([]);
  });
});

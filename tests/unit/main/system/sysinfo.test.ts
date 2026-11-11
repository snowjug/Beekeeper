import { describe, expect, it, vi } from 'vitest';
import {
  cpuUsagePercent,
  createSystemInfoApi,
  describeOs,
  nodeHost,
  type CpuSample,
  type HostInfo,
} from '@main/system/sysinfo';
import { SystemError } from '@main/system/types';

function cpu(idle: number, busy: number, model = 'Intel(R) Core(TM) i7'): CpuSample {
  return { model, times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } };
}

describe('describeOs', () => {
  it.each([
    ['10.0.26100', 'Windows 11 Enterprise', 'Windows 11 Enterprise (build 26100)'],
    ['10.0.22631', 'Windows 10 Pro', 'Windows 11 Pro (build 22631)'],
    ['10.0.19045', 'Windows 10 Home', 'Windows 10 Home (build 19045)'],
    ['10.0.22000', 'Windows 11', 'Windows 11 (build 22000)'],
    ['10.0.26300', 'Windows 11 Pro', 'Windows 11 Pro (build 26300)'],
    [
      '10.0.20348',
      'Windows Server 2022 Datacenter',
      'Windows Server 2022 Datacenter (build 20348)',
    ],
    ['10.0.19045', '', 'Windows (build 19045)'],
  ])('describes %s / %s as %s', (release, version, expected) => {
    expect(describeOs(release, version, 'win32')).toBe(expected);
  });

  it('falls back to the product name for other releases and platforms', () => {
    expect(describeOs('6.3.9600', 'Windows 8.1 Pro', 'win32')).toBe('Windows 8.1 Pro');
    expect(describeOs('6.3.9600', '', 'win32')).toBe('6.3.9600');
    expect(describeOs('6.8.0', 'Ubuntu 24.04', 'linux')).toBe('Ubuntu 24.04');
  });
});

describe('cpuUsagePercent', () => {
  it('uses the share of busy time between two samples', () => {
    const before = [cpu(1000, 1000), cpu(1000, 1000)];
    const after = [cpu(1900, 1100), cpu(1500, 1500)];
    // busy = 100 + 500, idle = 900 + 500, total 2000
    expect(cpuUsagePercent(before, after)).toBe(30);
  });

  it.each([
    [[cpu(100, 100)], [cpu(100, 100)], 0],
    [[cpu(0, 0)], [cpu(0, 1000)], 100],
    [[], [], 0],
    [[cpu(10, 10)], [cpu(5, 5)], 0],
  ])('handles the edge case %#', (before, after, expected) => {
    expect(cpuUsagePercent(before, after)).toBe(expected);
  });

  it('ignores cores that only appear in one sample and rounds to one decimal', () => {
    expect(cpuUsagePercent([cpu(0, 0), cpu(0, 0)], [cpu(2, 1)])).toBe(33.3);
  });
});

function host(overrides: Partial<HostInfo> = {}): HostInfo {
  let sample = 0;
  return {
    cpus: () =>
      sample++ === 0 ? [cpu(1000, 1000), cpu(1000, 1000)] : [cpu(1800, 1200), cpu(1800, 1200)],
    totalMemory: () => 16 * 1024 ** 3,
    freeMemory: () => 4 * 1024 ** 3,
    uptimeSeconds: () => 3600.9,
    osRelease: () => '10.0.26100',
    osVersion: () => 'Windows 11 Enterprise',
    statfs: () => Promise.resolve({ bsize: 4096, blocks: 100_000_000, bavail: 40_000_000 }),
    ...overrides,
  };
}

describe('getSystemInfo', () => {
  it('assembles OS, CPU, memory, disk and uptime', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const statfs = vi.fn(() =>
      Promise.resolve({ bsize: 4096, blocks: 100_000_000, bavail: 40_000_000 }),
    );
    const info = await createSystemInfoApi({
      host: host({ statfs }),
      env: { SystemDrive: 'D:' },
      platform: 'win32',
      sleep,
    }).getSystemInfo();

    expect(sleep).toHaveBeenCalledWith(400);
    expect(statfs).toHaveBeenCalledWith('D:\\');
    expect(info).toEqual({
      os: 'Windows 11 Enterprise (build 26100)',
      cpu: { name: 'Intel(R) Core(TM) i7', cores: 2, usagePercent: 20 },
      memory: {
        totalBytes: 16 * 1024 ** 3,
        usedBytes: 12 * 1024 ** 3,
        usagePercent: 75,
      },
      disk: {
        drive: 'D:',
        totalBytes: 4096 * 100_000_000,
        freeBytes: 4096 * 40_000_000,
        usagePercent: 60,
      },
      uptimeSeconds: 3600,
    });
  });

  it('defaults to the C: drive and collapses whitespace in the processor name', async () => {
    const statfs = vi.fn(() => Promise.resolve({ bsize: 1, blocks: 10, bavail: 5 }));
    const info = await createSystemInfoApi({
      host: host({ statfs, cpus: () => [cpu(1, 1, '  Intel(R)   Core(TM)  Ultra 7 ')] }),
      env: {},
      platform: 'win32',
      sleep: () => Promise.resolve(),
    }).getSystemInfo();
    expect(statfs).toHaveBeenCalledWith('C:\\');
    expect(info.cpu.name).toBe('Intel(R) Core(TM) Ultra 7');
    expect(info.cpu.cores).toBe(1);
    expect(info.disk).toMatchObject({ drive: 'C:', usagePercent: 50 });
  });

  it('copes with a machine that reports no memory or processors', async () => {
    const info = await createSystemInfoApi({
      host: host({
        cpus: () => [],
        totalMemory: () => 0,
        freeMemory: () => 10,
        statfs: () => Promise.resolve({ bsize: 4096, blocks: 0, bavail: 0 }),
      }),
      env: {},
      platform: 'win32',
      sleep: () => Promise.resolve(),
    }).getSystemInfo();
    expect(info.cpu).toEqual({ name: 'Unknown processor', cores: 0, usagePercent: 0 });
    expect(info.memory).toEqual({ totalBytes: 0, usedBytes: 0, usagePercent: 0 });
    expect(info.disk.usagePercent).toBe(0);
  });

  it('reports a drive that cannot be read', async () => {
    const api = createSystemInfoApi({
      host: host({ statfs: () => Promise.reject(new Error('EPERM')) }),
      env: {},
      platform: 'win32',
      sleep: () => Promise.resolve(),
    });
    await expect(api.getSystemInfo()).rejects.toBeInstanceOf(SystemError);
    await expect(api.getSystemInfo()).rejects.toMatchObject({
      code: 'failed',
      message: 'Could not read the size of drive C:.',
    });
  });
});

describe('nodeHost', () => {
  it('reads real values from this machine', async () => {
    expect(nodeHost.cpus().length).toBeGreaterThan(0);
    expect(nodeHost.totalMemory()).toBeGreaterThan(nodeHost.freeMemory() - 1);
    expect(nodeHost.uptimeSeconds()).toBeGreaterThan(0);
    expect(nodeHost.osRelease()).toMatch(/\d/);
    expect(nodeHost.osVersion().length).toBeGreaterThan(0);
    const stats = await nodeHost.statfs(process.cwd());
    expect(stats.blocks).toBeGreaterThan(0);
    expect(stats.bsize).toBeGreaterThan(0);
  });
});

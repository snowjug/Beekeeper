import * as os from 'node:os';
import { statfs } from 'node:fs/promises';
import { win32 } from 'node:path';
import { getEnv } from './exec';
import { clamp } from './guards';
import { SystemError, type SystemApi, type SystemInfoData } from './types';

export type SystemInfoApi = Pick<SystemApi, 'getSystemInfo'>;

export interface CpuSample {
  model: string;
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

/** The host facts system info is made of. Injected so tests do not depend on this machine. */
export interface HostInfo {
  cpus(): CpuSample[];
  totalMemory(): number;
  freeMemory(): number;
  uptimeSeconds(): number;
  /** e.g. "10.0.26100" */
  osRelease(): string;
  /** e.g. "Windows 11 Enterprise" */
  osVersion(): string;
  statfs(path: string): Promise<{ bsize: number; blocks: number; bavail: number }>;
}

export const nodeHost: HostInfo = {
  cpus: () => os.cpus(),
  totalMemory: () => os.totalmem(),
  freeMemory: () => os.freemem(),
  uptimeSeconds: () => os.uptime(),
  osRelease: () => os.release(),
  osVersion: () => os.version(),
  statfs: async (path) => {
    const stats = await statfs(path);
    return { bsize: stats.bsize, blocks: stats.blocks, bavail: stats.bavail };
  },
};

/** First Windows 11 build; Windows 11 still reports "10.0" and often "Windows 10" as product name. */
const WINDOWS_11_BUILD = 22_000;
const CPU_SAMPLE_MS = 400;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "10.0.26100" + "Windows 11 Enterprise" -> "Windows 11 Enterprise (build 26100)". */
export function describeOs(release: string, version: string, platform: NodeJS.Platform): string {
  const build = /^10\.0\.(\d+)/.exec(release)?.[1];
  const product = version.trim();
  if (platform !== 'win32' || build === undefined) return product || release;
  const parts = /^Windows\s+(\d+)\s*(.*)$/i.exec(product);
  if (parts === null) return `${product || 'Windows'} (build ${build})`;
  const name = Number(build) >= WINDOWS_11_BUILD ? 'Windows 11' : `Windows ${parts[1] ?? '10'}`;
  return `${[name, parts[2] ?? ''].filter((part) => part !== '').join(' ')} (build ${build})`;
}

/** Share of non-idle CPU time between two os.cpus() samples, 0-100. */
export function cpuUsagePercent(before: readonly CpuSample[], after: readonly CpuSample[]): number {
  let idle = 0;
  let total = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const start = before[index]?.times;
    const end = after[index]?.times;
    if (start === undefined || end === undefined) continue;
    const sum = (times: CpuSample['times']): number =>
      times.user + times.nice + times.sys + times.idle + times.irq;
    idle += end.idle - start.idle;
    total += sum(end) - sum(start);
  }
  if (total <= 0) return 0;
  return round1(clamp((1 - idle / total) * 100, 0, 100));
}

export interface SystemInfoOptions {
  host: HostInfo;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  sleep: (ms: number) => Promise<void>;
}

export function createSystemInfoApi(options: SystemInfoOptions): SystemInfoApi {
  const { host, env, platform, sleep } = options;
  return {
    async getSystemInfo(): Promise<SystemInfoData> {
      const before = host.cpus();
      await sleep(CPU_SAMPLE_MS);
      const after = host.cpus();

      const totalBytes = host.totalMemory();
      const usedBytes = Math.max(0, totalBytes - host.freeMemory());

      const drive = getEnv(env, 'SystemDrive') ?? 'C:';
      let diskTotal: number;
      let diskFree: number;
      try {
        const stats = await host.statfs(win32.join(drive, '\\'));
        diskTotal = stats.blocks * stats.bsize;
        diskFree = stats.bavail * stats.bsize;
      } catch (error) {
        throw new SystemError('failed', `Could not read the size of drive ${drive}.`, {
          cause: error,
        });
      }

      return {
        os: describeOs(host.osRelease(), host.osVersion(), platform),
        cpu: {
          name: (before[0]?.model ?? 'Unknown processor').replace(/\s+/g, ' ').trim(),
          cores: before.length,
          usagePercent: cpuUsagePercent(before, after),
        },
        memory: {
          totalBytes,
          usedBytes,
          usagePercent: totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : 0,
        },
        disk: {
          drive,
          totalBytes: diskTotal,
          freeBytes: diskFree,
          usagePercent: diskTotal > 0 ? round1(((diskTotal - diskFree) / diskTotal) * 100) : 0,
        },
        uptimeSeconds: Math.floor(host.uptimeSeconds()),
      };
    },
  };
}

import { win32 } from 'node:path';
import type { Logger } from '@shared/logger';
import { createAppsApi } from './apps';
import { createAudioApi } from './audio';
import { createBatteryApi } from './battery';
import { createDisplayApi } from './display';
import {
  defaultExecFile,
  defaultSpawnDetached,
  getEnv,
  resolveSystemPaths,
  type ExecFileFn,
  type SpawnDetachedFn,
} from './exec';
import { createPowerShellRunner } from './powershell';
import { createScreenshotApi, type CapturedScreen } from './screenshots';
import { createShellApi } from './shell';
import { createSystemInfoApi, nodeHost, type HostInfo } from './sysinfo';
import { nodeFs, type SystemFs } from './systemFs';
import type { SystemApi } from './types';

export interface SystemApiOptions {
  /** Folder that contains `scripts/` (process.resourcesPath when packaged, <repo>\resources in dev). */
  resourcesDir: string;
  /** Where screenshots are saved (Pictures\Beekeeper). */
  picturesDir: string;
  /** Captures the display under the cursor; provided by the capture module. */
  capture: () => Promise<CapturedScreen>;
  logger: Logger;
  exec?: ExecFileFn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Cache for compiled helper assemblies. Default `%LOCALAPPDATA%\Beekeeper\cache`. */
  cacheDir?: string;
  spawnDetached?: SpawnDetachedFn;
  fs?: SystemFs;
  host?: HostInfo;
  sleep?: (ms: number) => Promise<void>;
  /** Process id closeApp must never close. Default: this process. */
  selfPid?: number;
}

export interface SystemApiRuntime extends SystemApi {
  /**
   * Rescans the Start menu and packaged apps (~2 s). Call it once in the background after start-up
   * so the first "open <app>" is instant; resolves with the number of indexed apps.
   */
  refreshApps(): Promise<number>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultCacheDir(env: NodeJS.ProcessEnv): string | undefined {
  const localAppData = getEnv(env, 'LOCALAPPDATA');
  return localAppData === undefined || localAppData === ''
    ? undefined
    : win32.join(localAppData, 'Beekeeper', 'cache');
}

/** The Windows integration used by the commands. Everything is injectable for tests. */
export function createSystemApi(options: SystemApiOptions): SystemApiRuntime {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? defaultExecFile;
  const spawnDetached = options.spawnDetached ?? defaultSpawnDetached;
  const fs = options.fs ?? nodeFs;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const { logger } = options;
  const paths = resolveSystemPaths(env);

  const runner = createPowerShellRunner({
    exec,
    powershellPath: paths.powershell,
    scriptsDir: win32.join(options.resourcesDir, 'scripts'),
    cacheDir: options.cacheDir ?? defaultCacheDir(env),
    platform,
    logger,
    now,
  });

  return {
    ...createAppsApi({
      runner,
      exec,
      spawnDetached,
      fs,
      env,
      paths,
      logger,
      now,
      sleep,
      selfPid: options.selfPid ?? process.pid,
    }),
    ...createAudioApi(runner),
    ...createDisplayApi(runner),
    ...createBatteryApi(runner),
    ...createSystemInfoApi({ host: options.host ?? nodeHost, env, platform, sleep }),
    ...createShellApi({ runner, exec, spawnDetached, paths, platform, logger }),
    ...createScreenshotApi({
      capture: options.capture,
      picturesDir: options.picturesDir,
      fs,
      now,
    }),
  };
}

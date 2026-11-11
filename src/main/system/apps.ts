import type { Logger } from '@shared/logger';
import { displayNameFor } from './appAliases';
import { AppIndex } from './appIndex';
import { rankApps } from './appRanking';
import { isUriTarget } from './builtinApps';
import { toSystemError, type ExecFileFn, type SpawnDetachedFn, type SystemPaths } from './exec';
import { isRecord } from './guards';
import type { PowerShellRunner } from './powershell';
import { NO_FORCE_PROCESSES, matchProcesses, parseWindowList } from './processes';
import type { SystemFs } from './systemFs';
import {
  SystemError,
  type AppMatch,
  type CloseAppResult,
  type InstalledApp,
  type SystemApi,
} from './types';

export type AppsApi = Pick<SystemApi, 'findApps' | 'launchApp' | 'closeApp'> & {
  /** Rescans the Start menu in the background-friendly way; resolves with the number of indexed apps. */
  refreshApps(): Promise<number>;
};

export interface AppsApiOptions {
  runner: PowerShellRunner;
  exec: ExecFileFn;
  spawnDetached: SpawnDetachedFn;
  fs: SystemFs;
  env: NodeJS.ProcessEnv;
  paths: SystemPaths;
  logger: Logger;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Process id of Beekeeper itself, which closeApp never touches. */
  selfPid: number;
  ttlMs?: number;
  /** How long a weak first match waits for the packaged apps to finish loading. Default 6 s. */
  uwpWaitMs?: number;
}

/** Scores from this value on are trusted without waiting for the slow packaged-app list. */
const STRONG_MATCH_SCORE = 0.9;
const DEFAULT_UWP_WAIT_MS = 6000;
const CLOSE_WAIT_MS = 3000;
const CLOSE_TIMEOUT_MS = 20_000;
const KILL_TIMEOUT_MS = 10_000;
const MAX_QUERY_LENGTH = 100;
/** taskkill exit code for "the process was not found". */
const TASKKILL_NOT_FOUND = 128;

function parseRemainingPids(reply: unknown): Set<number> {
  if (!isRecord(reply) || !Array.isArray(reply.remaining)) {
    throw new SystemError('failed', 'The "close-windows" helper returned an unexpected reply.');
  }
  const pids = new Set<number>();
  for (const pid of reply.remaining as unknown[]) {
    if (typeof pid === 'number' && Number.isInteger(pid)) pids.add(pid);
  }
  return pids;
}

function isProcessGone(error: unknown): boolean {
  return isRecord(error) && error.code === TASKKILL_NOT_FOUND;
}

export function createAppsApi(options: AppsApiOptions): AppsApi {
  const { runner, exec, spawnDetached, fs, paths, logger, selfPid } = options;
  const uwpWaitMs = options.uwpWaitMs ?? DEFAULT_UWP_WAIT_MS;
  const index = new AppIndex({
    runner,
    fs,
    env: options.env,
    logger,
    now: options.now,
    sleep: options.sleep,
    ttlMs: options.ttlMs,
  });

  async function startApp(app: InstalledApp): Promise<void> {
    switch (app.kind) {
      case 'shortcut':
        if (!(await fs.exists(app.target))) {
          throw new SystemError('not-found', `The shortcut for ${app.name} no longer exists.`);
        }
        await spawnDetached(paths.explorer, [app.target]);
        return;
      case 'uwp':
        await spawnDetached(paths.explorer, [`shell:AppsFolder\\${app.target}`]);
        return;
      case 'builtin':
        // Built-in targets are fixed names from builtinApps.ts (membership was checked by the caller).
        if (isUriTarget(app.target)) {
          await spawnDetached(paths.explorer, [app.target]);
        } else {
          // `start` gives console programs (cmd, PowerShell) their own window.
          await spawnDetached(paths.cmd, ['/d', '/c', 'start', '', app.target], { hidden: true });
        }
    }
  }

  async function gracefulClose(matches: CloseAppResult['processes']): Promise<CloseAppResult> {
    const targets = matches.map((match) => `${match.pid}:${match.name}`).join('|');
    const reply = await runner.run(
      'close-windows',
      { Targets: targets, WaitMs: CLOSE_WAIT_MS },
      { timeoutMs: CLOSE_TIMEOUT_MS },
    );
    const remaining = parseRemainingPids(reply);
    const stillOpen = matches.filter((match) => remaining.has(match.pid));
    return stillOpen.length === 0
      ? { status: 'closed', processes: matches }
      : { status: 'needs-force', processes: stillOpen };
  }

  async function forceClose(
    query: string,
    matches: CloseAppResult['processes'],
  ): Promise<CloseAppResult> {
    const killable = matches.filter((match) => !NO_FORCE_PROCESSES.has(match.name.toLowerCase()));
    if (killable.length === 0) {
      throw new SystemError(
        'unsupported',
        `${displayNameFor(query)} is part of Windows, so it can't be force closed.`,
      );
    }
    const failed: string[] = [];
    for (const target of killable) {
      try {
        await exec(paths.taskkill, ['/PID', String(target.pid), '/F'], {
          timeout: KILL_TIMEOUT_MS,
        });
      } catch (error) {
        if (!isProcessGone(error)) {
          logger.warn(`taskkill failed for ${target.name} (${target.pid})`, error);
          failed.push(target.name);
        }
      }
    }
    if (failed.length > 0) {
      throw new SystemError('failed', `Windows would not end ${failed.join(', ')}.`);
    }
    return { status: 'closed', processes: killable };
  }

  return {
    async findApps(query, limit = 5): Promise<AppMatch[]> {
      const text = query.trim();
      if (text === '') return [];
      let matches = rankApps(text, await index.snapshot(), limit);
      if (!index.isUwpLoaded && (matches[0]?.score ?? 0) < STRONG_MATCH_SCORE) {
        await index.waitForUwp(uwpWaitMs);
        matches = rankApps(text, await index.snapshot(), limit);
      }
      return matches;
    },

    async launchApp(app) {
      await index.snapshot();
      if (!index.contains(app)) {
        throw new SystemError('not-found', `${app.name} is not in the list of installed apps.`);
      }
      try {
        await startApp(app);
      } catch (error) {
        throw toSystemError(error, `Starting ${app.name}`);
      }
    },

    async closeApp(query, closeOptions = {}) {
      const text = query.trim();
      if (text === '' || text.length > MAX_QUERY_LENGTH) {
        throw new SystemError('invalid-argument', 'Tell me which app to close.');
      }
      const windows = parseWindowList(await runner.run('windows'));
      const { matches, protectedName } = matchProcesses(text, windows, selfPid);
      if (matches.length === 0) {
        if (protectedName !== null) {
          throw new SystemError(
            'unsupported',
            `${displayNameFor(text)} is part of Windows, so I won't close it.`,
          );
        }
        return { status: 'not-running', processes: [] };
      }
      return closeOptions.force === true ? forceClose(text, matches) : gracefulClose(matches);
    },

    async refreshApps() {
      return (await index.refresh()).length;
    },
  };
}

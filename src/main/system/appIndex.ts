import { win32 } from 'node:path';
import type { Logger } from '@shared/logger';
import { normalizeAppName } from './appAliases';
import { builtinApps } from './builtinApps';
import { getEnv } from './exec';
import { isRecord } from './guards';
import type { PowerShellRunner } from './powershell';
import type { DirEntry, SystemFs } from './systemFs';
import type { InstalledApp } from './types';

export const APP_INDEX_TTL_MS = 10 * 60_000;

const MAX_SCAN_DEPTH = 6;
const MAX_SHORTCUTS_PER_ROOT = 4000;
const UWP_LIST_TIMEOUT_MS = 30_000;
/** AppUserModelIDs ("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "Chrome"); paths and GUID folders are rejected. */
const APP_USER_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:![A-Za-z0-9._-]+)?$/;
const NOISE_NAME =
  /\b(?:uninstall(?:er)?|remove|help|read ?me|documentation|manuals?|user guide|web ?site|release notes|licen[cs]es?|eula|changelog)\b/i;

/** Start menu entries that are not apps people want to open (uninstallers, help pages, web links). */
export function isNoiseName(name: string): boolean {
  return NOISE_NAME.test(name);
}

export interface ScannedShortcut {
  name: string;
  path: string;
}

export interface StartApp {
  name: string;
  appId: string;
}

/** Per-user and all-users "Start Menu\Programs" folders. */
export function startMenuRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = [];
  for (const variable of ['APPDATA', 'ProgramData']) {
    const base = getEnv(env, variable);
    if (base !== undefined && base !== '') {
      roots.push(win32.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    }
  }
  return roots;
}

async function scanRoot(root: string, fs: SystemFs, logger: Logger): Promise<ScannedShortcut[]> {
  const found: ScannedShortcut[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    let entries: DirEntry[];
    try {
      entries = await fs.readdir(directory);
    } catch (error) {
      logger.debug(`Start menu folder not readable: ${directory}`, error);
      return;
    }
    const subfolders: Promise<void>[] = [];
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (depth < MAX_SCAN_DEPTH)
          subfolders.push(walk(win32.join(directory, entry.name), depth + 1));
        continue;
      }
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.lnk')) continue;
      const name = entry.name.slice(0, -'.lnk'.length).trim();
      if (name === '' || isNoiseName(name)) continue;
      if (found.length < MAX_SHORTCUTS_PER_ROOT) {
        found.push({ name, path: win32.join(directory, entry.name) });
      }
    }
    await Promise.all(subfolders);
  }

  await walk(root, 0);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** Recursively collects the .lnk shortcuts of the Start menu folders, user folder first. */
export async function scanStartMenu(
  roots: readonly string[],
  fs: SystemFs,
  logger: Logger,
): Promise<ScannedShortcut[]> {
  const perRoot = await Promise.all(roots.map((root) => scanRoot(root, fs, logger)));
  return perRoot.flat();
}

/** Validates the reply of uwp-apps.ps1 and keeps the entries that can be launched by AppUserModelID. */
export function parseStartApps(data: unknown): StartApp[] {
  if (!Array.isArray(data)) return [];
  const apps: StartApp[] = [];
  for (const item of data as unknown[]) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.appId !== 'string')
      continue;
    const name = item.name.trim();
    if (name !== '' && !isNoiseName(name) && APP_USER_MODEL_ID.test(item.appId)) {
      apps.push({ name, appId: item.appId });
    }
  }
  return apps;
}

function shortcutApp(shortcut: ScannedShortcut): InstalledApp {
  return {
    name: shortcut.name,
    key: normalizeAppName(shortcut.name),
    kind: 'shortcut',
    target: shortcut.path,
  };
}

function uwpApp(app: StartApp): InstalledApp {
  return { name: app.name, key: normalizeAppName(app.name), kind: 'uwp', target: app.appId };
}

/** One entry per name: built-ins win over shortcuts, shortcuts over AppUserModelIDs. */
export function mergeApps(...groups: ReadonlyArray<readonly InstalledApp[]>): InstalledApp[] {
  const seen = new Set<string>();
  const merged: InstalledApp[] = [];
  for (const app of groups.flat()) {
    if (app.key === '' || seen.has(app.key)) continue;
    seen.add(app.key);
    merged.push(app);
  }
  return merged;
}

export interface AppIndexOptions {
  runner: PowerShellRunner;
  fs: SystemFs;
  env: NodeJS.ProcessEnv;
  logger: Logger;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  ttlMs?: number;
}

/**
 * In-memory list of launchable apps. Start menu shortcuts and built-ins are indexed first (tens of
 * milliseconds); the packaged apps come from Get-StartApps, which takes ~2 s, so they load in the
 * background. An index older than the TTL is refreshed in the background while the old one keeps serving.
 */
export class AppIndex {
  private apps: readonly InstalledApp[] = [];
  private fastApps: InstalledApp[] = [];
  private uwpApps: InstalledApp[] = [];
  private fastReady: Promise<void> | null = null;
  private uwpReady: Promise<void> = Promise.resolve();
  private uwpLoaded = false;
  private build: Promise<void> | null = null;
  private loadedAt = 0;
  private readonly ttlMs: number;

  constructor(private readonly options: AppIndexOptions) {
    this.ttlMs = options.ttlMs ?? APP_INDEX_TTL_MS;
  }

  get isUwpLoaded(): boolean {
    return this.uwpLoaded;
  }

  /** The current list, building it on first use and refreshing it in the background when stale. */
  async snapshot(): Promise<readonly InstalledApp[]> {
    if (this.fastReady === null || this.isStale()) void this.startBuild();
    await (this.fastReady ?? Promise.resolve());
    return this.apps;
  }

  /** Waits (at most `timeoutMs`) until the packaged apps are part of the list. */
  async waitForUwp(timeoutMs: number): Promise<void> {
    if (this.uwpLoaded) return;
    await Promise.race([this.uwpReady, this.options.sleep(timeoutMs)]);
  }

  /** Rescans everything and resolves with the new list. */
  async refresh(): Promise<readonly InstalledApp[]> {
    await this.startBuild();
    return this.apps;
  }

  /** True when the app is part of the current list (apps outside it are never launched). */
  contains(app: InstalledApp): boolean {
    return this.apps.some((known) => known.kind === app.kind && known.target === app.target);
  }

  private isStale(): boolean {
    return this.build === null && this.options.now() - this.loadedAt > this.ttlMs;
  }

  private startBuild(): Promise<void> {
    if (this.build !== null) return this.build;
    const fast = this.scanFast().then((apps) => {
      this.fastApps = apps;
      this.merge();
    });
    const uwp = this.scanUwp().then((apps) => {
      this.uwpApps = apps;
      this.uwpLoaded = true;
      this.merge();
    });
    this.fastReady ??= fast;
    this.uwpReady = uwp;
    const build = Promise.all([fast, uwp])
      .then(() => {
        this.loadedAt = this.options.now();
      })
      .finally(() => {
        this.build = null;
      });
    this.build = build;
    return build;
  }

  private merge(): void {
    this.apps = mergeApps(this.fastApps, this.uwpApps);
  }

  private async scanFast(): Promise<InstalledApp[]> {
    const { env, fs, logger } = this.options;
    const builtins = builtinApps();
    try {
      const shortcuts = await scanStartMenu(startMenuRoots(env), fs, logger);
      return [...builtins, ...shortcuts.map(shortcutApp)];
    } catch (error) {
      logger.warn('Scanning the Start menu failed', error);
      return builtins;
    }
  }

  private async scanUwp(): Promise<InstalledApp[]> {
    const { runner, logger } = this.options;
    try {
      const data = await runner.run('uwp-apps', {}, { timeoutMs: UWP_LIST_TIMEOUT_MS });
      return parseStartApps(data).map(uwpApp);
    } catch (error) {
      logger.warn('Listing Start menu apps failed; packaged apps will not be found', error);
      return [];
    }
  }
}

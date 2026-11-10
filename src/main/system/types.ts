/**
 * Windows integration surface used by commands. The real implementation lives in
 * src/main/system and talks to PowerShell / WMI / the shell through execFile with
 * argument arrays only. Tests inject fakes.
 */

export type SystemErrorCode =
  'unsupported' | 'failed' | 'not-found' | 'timeout' | 'invalid-argument';

export class SystemError extends Error {
  constructor(
    readonly code: SystemErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SystemError';
  }
}

export interface InstalledApp {
  /** Display name, e.g. "Visual Studio Code". */
  name: string;
  /** Normalised lower-case name used for matching. */
  key: string;
  kind: 'shortcut' | 'uwp' | 'builtin';
  /** .lnk path (shortcut), AppUserModelID (uwp) or a fixed whitelisted target (builtin). */
  target: string;
}

export interface AppMatch {
  app: InstalledApp;
  /** 0..1 */
  score: number;
}

export interface RunningProcess {
  pid: number;
  /** Process image name without extension, e.g. "notepad". */
  name: string;
  /** Main window title (may be empty). */
  title: string;
}

export interface CloseAppResult {
  /** needs-force: windows were asked to close but are still running. */
  status: 'closed' | 'not-running' | 'needs-force';
  processes: RunningProcess[];
}

export type SettingsPage = 'wifi' | 'bluetooth' | 'display' | 'sound';

export interface VolumeState {
  /** 0-100 */
  percent: number;
  muted: boolean;
}

export interface BatteryInfo {
  hasBattery: boolean;
  /** 0-100, undefined without a battery. */
  percent?: number;
  charging: boolean;
  onAc: boolean;
  minutesRemaining?: number;
}

export interface SystemInfoData {
  os: string;
  cpu: { name: string; cores: number; usagePercent: number };
  memory: { totalBytes: number; usedBytes: number; usagePercent: number };
  disk: { drive: string; totalBytes: number; freeBytes: number; usagePercent: number };
  uptimeSeconds: number;
}

export interface ScreenshotResult {
  /** Absolute path of the PNG in Pictures\Beekeeper. */
  path: string;
  width: number;
  height: number;
}

export interface SystemApi {
  // --- apps -----------------------------------------------------------------
  /** Fuzzy-matches installed apps (Start Menu shortcuts, UWP apps) plus built-in aliases. Best first. */
  findApps(query: string, limit?: number): Promise<AppMatch[]>;
  /** Launches an app previously returned by findApps. Arbitrary paths are never launched. */
  launchApp(app: InstalledApp): Promise<void>;
  /** Gracefully closes windows of apps matching `query`. With `force`, kills what remains. */
  closeApp(query: string, options?: { force?: boolean }): Promise<CloseAppResult>;

  // --- shell ----------------------------------------------------------------
  openSettingsPage(page: SettingsPage): Promise<void>;
  lockWorkstation(): Promise<void>;
  emptyRecycleBin(): Promise<void>;
  power(action: 'shutdown' | 'restart' | 'sleep'): Promise<void>;
  /** Returns the theme that is active after the change. */
  setDarkMode(mode: 'dark' | 'light' | 'toggle'): Promise<'dark' | 'light'>;
  takeScreenshot(): Promise<ScreenshotResult>;

  // --- audio / display ------------------------------------------------------
  getVolume(): Promise<VolumeState>;
  setVolume(percent: number): Promise<VolumeState>;
  /** Positive or negative percentage-point change, clamped to 0-100. */
  adjustVolume(deltaPercent: number): Promise<VolumeState>;
  setMuted(muted: boolean): Promise<VolumeState>;
  /** null when the display does not support software brightness (desktop monitors). */
  getBrightness(): Promise<number | null>;
  /** Throws SystemError('unsupported') on displays without brightness control. */
  setBrightness(percent: number): Promise<number>;

  // --- info -----------------------------------------------------------------
  getBattery(): Promise<BatteryInfo>;
  getSystemInfo(): Promise<SystemInfoData>;
}

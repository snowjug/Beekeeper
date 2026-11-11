import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { Menu, nativeImage, Tray, type NativeImage } from 'electron';
import type { Logger } from '@shared/logger';
import { parseTaskbarTheme, TASKBAR_THEME_QUERY_ARGS } from './taskbarTheme';

export type TrayState = 'idle' | 'listening' | 'armed';

export interface TrayActions {
  toggleAssistant(): void;
  openCircle(): void;
  openNotes(): void;
  openTimers(): void;
  openSettings(): void;
  setStartWithWindows(enabled: boolean): void;
  checkForUpdates(): void;
  quit(): void;
}

export interface TrayDeps {
  assetsDir: string;
  actions: TrayActions;
  startWithWindows: () => boolean;
  assistantHotkey: () => string;
  version: string;
  logger: Logger;
}

const LISTENING_FRAMES = 8;
const FRAME_INTERVAL_MS = 110;

/** Reads the Windows *taskbar* theme (not the app theme): it decides which icon is legible. */
export function readTaskbarTheme(): Promise<'light' | 'dark'> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      [...TASKBAR_THEME_QUERY_ARGS],
      { windowsHide: true, timeout: 4000 },
      (error, stdout) => resolve(error ? 'dark' : parseTaskbarTheme(stdout)),
    );
  });
}

/**
 * Tray icon with three animated states (idle / listening / wake-word armed), light + dark taskbar
 * variants and the context menu from spec 4.8.
 */
export class TrayController {
  private tray: Tray | null = null;
  private state: TrayState = 'idle';
  private theme: 'light' | 'dark' = 'dark';
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly cache = new Map<string, NativeImage>();

  constructor(private readonly deps: TrayDeps) {}

  create(): void {
    this.tray = new Tray(this.icon());
    this.tray.on('click', () => this.deps.actions.toggleAssistant());
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.buildMenu()));
    this.refresh();
  }

  setState(state: TrayState): void {
    if (state === this.state) return;
    this.state = state;
    this.stopAnimation();
    if (state === 'listening') this.startAnimation();
    this.refresh();
  }

  setTaskbarTheme(theme: 'light' | 'dark'): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.refresh();
  }

  /** Rebuilds menu, tooltip and icon (hotkey, start-with-windows or theme changed). */
  refresh(): void {
    if (!this.tray) return;
    this.tray.setImage(this.icon());
    this.tray.setToolTip(this.tooltip());
    this.tray.setContextMenu(this.buildMenu());
  }

  /** What the tray currently shows (used by automated tests and diagnostics). */
  snapshot(): { created: boolean; state: TrayState; tooltip: string; iconMissing: boolean } {
    return {
      created: this.tray !== null && !this.tray.isDestroyed(),
      state: this.state,
      tooltip: this.tooltip(),
      iconMissing: this.icon().isEmpty(),
    };
  }

  destroy(): void {
    this.stopAnimation();
    this.tray?.destroy();
    this.tray = null;
  }

  private tooltip(): string {
    const suffix =
      this.state === 'listening'
        ? ' - listening'
        : this.state === 'armed'
          ? ' - listening for "Hey Beekeeper"'
          : '';
    return `Beekeeper ${this.deps.version} (${this.deps.assistantHotkey()})${suffix}`;
  }

  private startAnimation(): void {
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % LISTENING_FRAMES;
      this.tray?.setImage(this.icon());
    }, FRAME_INTERVAL_MS);
  }

  private stopAnimation(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.frame = 0;
  }

  private icon(): NativeImage {
    const name = this.state === 'listening' ? `listening-${this.frame}` : this.state;
    const file = join(this.deps.assetsDir, 'tray', `tray-${name}-${this.theme}.ico`);
    const cached = this.cache.get(file);
    if (cached) return cached;
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) this.deps.logger.warn(`Tray icon missing: ${file}`);
    this.cache.set(file, image);
    return image;
  }

  private buildMenu(): Menu {
    const { actions } = this.deps;
    return Menu.buildFromTemplate([
      { label: 'Open Beekeeper', click: () => actions.toggleAssistant() },
      { label: 'Circle to Search', click: () => actions.openCircle() },
      { type: 'separator' },
      { label: 'Notes', click: () => actions.openNotes() },
      { label: 'Timers', click: () => actions.openTimers() },
      { label: 'Settings', click: () => actions.openSettings() },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: this.deps.startWithWindows(),
        click: (item) => actions.setStartWithWindows(item.checked),
      },
      { label: 'Check for updates', click: () => actions.checkForUpdates() },
      { type: 'separator' },
      { label: 'Quit', click: () => actions.quit() },
    ]);
  }
}

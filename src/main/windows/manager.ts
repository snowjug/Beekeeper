import { release } from 'node:os';
import { join } from 'node:path';
import {
  BrowserWindow,
  nativeTheme,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';
import { canReceive, type EventChannel } from '@shared/ipc/channels';
import type { EventPayload } from '@shared/ipc/schemas';
import type { Logger } from '@shared/logger';
import { APP_ORIGIN, ROLE_PAGE, WINDOW_ROLES, type WindowRole } from '@shared/windows';
import type { AppPaths } from '../paths';
import { backdropFor, parseWindowsBuild, type BackdropMaterial } from './material';

export interface WindowManagerDeps {
  paths: AppPaths;
  logger: Logger;
  dev: boolean;
  /** Vite dev server origin, e.g. http://localhost:5173 */
  devOrigin: string | null;
}

type Pending = Array<() => void>;

/**
 * Owns every BrowserWindow. Windows are created lazily (or pre-created hidden for instant show),
 * always with the hardened webPreferences, and are looked up by role. Messages sent before a page
 * finished loading are queued and flushed on `did-finish-load`.
 */
export class WindowManager {
  private readonly windows = new Map<WindowRole, BrowserWindow>();
  private readonly loaded = new Set<WindowRole>();
  private readonly queues = new Map<WindowRole, Pending>();
  private readonly roleByContents = new Map<number, WindowRole>();
  readonly osBuild = parseWindowsBuild(release());

  constructor(private readonly deps: WindowManagerDeps) {}

  materialFor(role: WindowRole): BackdropMaterial {
    return backdropFor(role, this.osBuild);
  }

  urlFor(role: WindowRole, query = ''): string {
    const base = this.deps.devOrigin ?? APP_ORIGIN;
    return `${base}/${ROLE_PAGE[role]}/index.html${query ? `?${query}` : ''}`;
  }

  get(role: WindowRole): BrowserWindow | undefined {
    const win = this.windows.get(role);
    return win && !win.isDestroyed() ? win : undefined;
  }

  roleOf(contents: WebContents): WindowRole | null {
    return this.roleByContents.get(contents.id) ?? null;
  }

  isLoaded(role: WindowRole): boolean {
    return this.loaded.has(role);
  }

  /** Returns the window for `role`, creating (hidden) and loading it when needed. */
  ensure(role: WindowRole, query = ''): BrowserWindow {
    const existing = this.get(role);
    if (existing) return existing;

    const win = new BrowserWindow(this.optionsFor(role));
    this.windows.set(role, win);
    this.roleByContents.set(win.webContents.id, role);
    const contentsId = win.webContents.id;

    win.webContents.on('did-finish-load', () => {
      this.loaded.add(role);
      const queue = this.queues.get(role) ?? [];
      this.queues.delete(role);
      for (const flush of queue) flush();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      this.deps.logger.error(`Renderer for ${role} gone`, details.reason);
      this.loaded.delete(role);
    });
    win.on('unresponsive', () => this.deps.logger.warn(`Window ${role} is unresponsive`));
    win.on('closed', () => {
      this.windows.delete(role);
      this.loaded.delete(role);
      this.queues.delete(role);
      this.roleByContents.delete(contentsId);
    });

    void win.loadURL(this.urlFor(role, query)).catch((error: unknown) => {
      this.deps.logger.error(`Failed to load the ${role} window`, error);
    });
    return win;
  }

  /** Sends an event to one window (queued while its page is still loading). */
  send<C extends EventChannel>(role: WindowRole, channel: C, payload: EventPayload<C>): void {
    if (!canReceive(role, channel)) return;
    const win = this.get(role);
    if (!win) return;
    const deliver = (): void => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };
    if (this.loaded.has(role)) {
      deliver();
      return;
    }
    const queue = this.queues.get(role) ?? [];
    queue.push(deliver);
    this.queues.set(role, queue);
  }

  /** Sends an event to every existing window that is allowed to receive it. */
  broadcast<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
    for (const role of WINDOW_ROLES) this.send(role, channel, payload);
  }

  destroy(role: WindowRole): void {
    const win = this.get(role);
    if (win) win.destroy();
  }

  destroyAll(): void {
    for (const role of WINDOW_ROLES) this.destroy(role);
  }

  /** Resolves once the role's page has loaded (immediately when it already did). */
  whenLoaded(role: WindowRole): Promise<void> {
    if (this.loaded.has(role)) return Promise.resolve();
    return new Promise((resolve) => {
      const queue = this.queues.get(role) ?? [];
      queue.push(resolve);
      this.queues.set(role, queue);
    });
  }

  private optionsFor(role: WindowRole): BrowserWindowConstructorOptions {
    const dark = nativeTheme.shouldUseDarkColors;
    const common: BrowserWindowConstructorOptions = {
      show: false,
      title: 'Beekeeper',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(this.deps.paths.preloadDir, `${role}.js`),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        devTools: this.deps.dev,
        // Only the wake-word worker must keep running while hidden.
        backgroundThrottling: role !== 'worker',
      },
    };

    switch (role) {
      case 'assistant':
        return {
          ...common,
          width: 784,
          height: 600,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: false,
        };
      case 'circle':
        return {
          ...common,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: false,
        };
      case 'edgeGlow':
        return {
          ...common,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: false,
        };
      case 'settings':
        return {
          ...common,
          title: 'Beekeeper Settings',
          width: 1020,
          height: 720,
          minWidth: 780,
          minHeight: 560,
          ...this.framedOptions(role, dark),
        };
      case 'onboarding':
        return {
          ...common,
          title: 'Welcome to Beekeeper',
          width: 900,
          height: 660,
          resizable: false,
          maximizable: false,
          fullscreenable: false,
          ...this.framedOptions(role, dark),
        };
      case 'worker':
        return { ...common, width: 320, height: 240, focusable: false, skipTaskbar: true };
    }
  }

  /** Hidden title bar with native caption buttons drawn over the page, Mica when supported. */
  private framedOptions(role: WindowRole, dark: boolean): BrowserWindowConstructorOptions {
    const material = this.materialFor(role);
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: dark ? '#f5f5f7' : '#1b1b1f',
        height: 40,
      },
      backgroundColor: material === 'none' ? (dark ? '#1b1b21' : '#fafafc') : '#00000000',
      ...(material === 'none' ? {} : { backgroundMaterial: material }),
    };
  }

  /** Keeps native caption button colours in sync with the theme. */
  updateTitleBarOverlays(): void {
    const dark = nativeTheme.shouldUseDarkColors;
    for (const role of ['settings', 'onboarding'] as const) {
      this.get(role)?.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: dark ? '#f5f5f7' : '#1b1b1f',
        height: 40,
      });
    }
  }
}

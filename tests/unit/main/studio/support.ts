import { win32 } from 'node:path';
import { vi, type Mock } from 'vitest';
import type { PinInfo, StudioSession, ToastEvent } from '@shared/ipc/types';
import type { Logger } from '@shared/logger';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { StudioFs } from '@main/studio/files';
import type { PinMenuItem } from '@main/studio/pinMenu';
import type {
  DisplayInfo,
  Notice,
  PinWindow,
  PinWindows,
  StudioPlatform,
  StudioWindow,
  StudioWindows,
} from '@main/studio/platform';
import type { StudioSettings } from '@main/studio/session';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** A structurally complete PNG (signature, IHDR, IEND) of the given size; the pixels are not real. */
export function makePng(width = 4, height = 3): Buffer {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write('IHDR', 4, 'ascii');
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  header[16] = 8;
  header[17] = 6;
  return Buffer.concat([SIGNATURE, header, IEND]);
}

export const PICTURES = 'C:\\Users\\tester\\Pictures\\Beekeeper';

export const DISPLAY: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

export interface SpyLogger extends Logger {
  debug: Mock<Logger['debug']>;
  info: Mock<Logger['info']>;
  warn: Mock<Logger['warn']>;
  error: Mock<Logger['error']>;
}

export function createLogger(): SpyLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

export function studioSettings(
  capture: Partial<StudioSettings['capture']> = {},
  aiAvailable = false,
): StudioSettings {
  return { capture: { ...DEFAULT_SETTINGS.capture, ...capture }, aiAvailable };
}

// ---- file system ---------------------------------------------------------------------------------

export interface MemoryFs extends StudioFs {
  files: Map<string, Buffer>;
  folders: Set<string>;
  /** Folders whose creation fails. */
  unwritable: Set<string>;
}

function key(path: string): string {
  return win32.normalize(path).toLowerCase();
}

export function createMemoryFs(initial: Record<string, Buffer> = {}): MemoryFs {
  const files = new Map<string, Buffer>();
  const folders = new Set<string>();
  const unwritable = new Set<string>();
  const names = new Map<string, string>();
  for (const [path, data] of Object.entries(initial)) {
    files.set(key(path), data);
    names.set(key(path), path);
  }
  const fail = (code: string): Error => Object.assign(new Error(code), { code });
  const store = (path: string, data: Uint8Array): void => {
    files.set(key(path), Buffer.from(data));
    names.set(key(path), path);
  };
  return {
    files,
    folders,
    unwritable,
    mkdir(path) {
      if (unwritable.has(key(path))) return Promise.reject(fail('EACCES'));
      folders.add(key(path));
      return Promise.resolve();
    },
    writeNewFile(path, data) {
      if (files.has(key(path))) return Promise.reject(fail('EEXIST'));
      store(path, data);
      return Promise.resolve();
    },
    overwriteFile(path, data) {
      store(path, data);
      return Promise.resolve();
    },
    readFile(path) {
      const data = files.get(key(path));
      return data ? Promise.resolve(data) : Promise.reject(fail('ENOENT'));
    },
    exists: (path) => Promise.resolve(files.has(key(path))),
    list(path) {
      const folder = key(path);
      return Promise.resolve(
        [...names.values()]
          .filter((original) => key(win32.dirname(original)) === folder)
          .map((original) => win32.basename(original)),
      );
    },
    remove(path) {
      files.delete(key(path));
      names.delete(key(path));
      return Promise.resolve();
    },
  };
}

// ---- windows ---------------------------------------------------------------------------------------

export class FakeStudioWindow implements StudioWindow {
  visible = false;
  closedListeners: Array<() => void> = [];
  readonly order: string[] = [];
  readonly show = vi.fn(() => {
    this.visible = true;
    this.order.push('show');
  });
  readonly hide = vi.fn(() => {
    this.visible = false;
    this.order.push('hide');
  });
  readonly focus = vi.fn();
  readonly raise = vi.fn();
  readonly setBounds = vi.fn();

  isVisible(): boolean {
    return this.visible;
  }

  onClosed(listener: () => void): void {
    this.closedListeners.push(listener);
  }

  /** The window was closed from outside (Alt+F4). */
  closeFromOutside(): void {
    for (const listener of this.closedListeners) listener();
  }
}

export interface FakeWindows extends StudioWindows {
  window: FakeStudioWindow | undefined;
  created: FakeStudioWindow[];
  sessions: StudioSession[];
  cancels: string[];
  toasts: ToastEvent[];
  destroy: Mock<() => void>;
  /** Called for every session the controller sends (to simulate the page decoding the image). */
  onSession: (session: StudioSession) => void;
}

export function createFakeWindows(): FakeWindows {
  const windows: FakeWindows = {
    window: undefined,
    created: [],
    sessions: [],
    cancels: [],
    toasts: [],
    onSession: () => undefined,
    ensure() {
      if (!windows.window) {
        windows.window = new FakeStudioWindow();
        windows.created.push(windows.window);
      }
      return windows.window;
    },
    get: () => windows.window,
    whenLoaded: () => Promise.resolve(),
    sendSession(session) {
      windows.sessions.push(session);
      windows.onSession(session);
    },
    sendCancel(reason) {
      windows.cancels.push(reason);
    },
    toast(toast) {
      windows.toasts.push(toast);
    },
    destroy: vi.fn(() => {
      windows.window = undefined;
    }),
  };
  return windows;
}

// ---- platform ----------------------------------------------------------------------------------------

export interface FakePlatform extends StudioPlatform {
  notices: Notice[];
  cursorDisplay: Mock<StudioPlatform['cursorDisplay']>;
  writeClipboardImage: Mock<StudioPlatform['writeClipboardImage']>;
  writeClipboardText: Mock<StudioPlatform['writeClipboardText']>;
  showSaveDialog: Mock<StudioPlatform['showSaveDialog']>;
  trashItem: Mock<StudioPlatform['trashItem']>;
  revealInFolder: Mock<StudioPlatform['revealInFolder']>;
  openFolder: Mock<StudioPlatform['openFolder']>;
  openExternal: Mock<StudioPlatform['openExternal']>;
  listenerCount: () => number;
  emitDisplayChange: () => void;
  displayList: DisplayInfo[];
  dark: { value: boolean };
}

export function createFakePlatform(): FakePlatform {
  const listeners = new Set<() => void>();
  const notices: Notice[] = [];
  const dark = { value: false };
  const platform: FakePlatform = {
    notices,
    displayList: [DISPLAY],
    dark,
    cursorDisplay: vi.fn(() => DISPLAY),
    displays: () => platform.displayList,
    isDark: () => dark.value,
    onDisplayChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    writeClipboardImage: vi.fn(() => Promise.resolve()),
    writeClipboardText: vi.fn(() => Promise.resolve()),
    showSaveDialog: vi.fn(() => Promise.resolve<string | null>(null)),
    trashItem: vi.fn(() => Promise.resolve()),
    revealInFolder: vi.fn(),
    openFolder: vi.fn(() => Promise.resolve(true)),
    openExternal: vi.fn(() => Promise.resolve()),
    notify: (notice) => {
      notices.push(notice);
    },
    listenerCount: () => listeners.size,
    emitDisplayChange: () => {
      for (const listener of [...listeners]) listener();
    },
  };
  return platform;
}

// ---- pins --------------------------------------------------------------------------------------------

export class FakePinWindow implements PinWindow {
  bounds: { x: number; y: number; width: number; height: number };
  opacity = 1;
  clickThrough = false;
  closed = false;
  readonly updates: PinInfo[] = [];
  readonly menus: PinMenuItem[][] = [];
  private readonly listeners: Array<() => void> = [];

  constructor(
    readonly webContentsId: number,
    bounds: { x: number; y: number; width: number; height: number },
    readonly query: string,
  ) {
    this.bounds = bounds;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds;
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds;
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setClickThrough(enabled: boolean): void {
    this.clickThrough = enabled;
  }

  send(info: PinInfo): void {
    this.updates.push(info);
  }

  popupMenu(items: PinMenuItem[]): void {
    this.menus.push(items);
  }

  close(): void {
    this.closed = true;
    for (const listener of this.listeners) listener();
  }

  onClosed(listener: () => void): void {
    this.listeners.push(listener);
  }
}

export function createFakePinWindows(): PinWindows & { windows: FakePinWindow[] } {
  const windows: FakePinWindow[] = [];
  return {
    windows,
    create(bounds, query) {
      const window = new FakePinWindow(100 + windows.length, bounds, query);
      windows.push(window);
      return window;
    },
  };
}

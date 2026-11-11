import {
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  Menu,
  nativeTheme,
  Notification,
  screen,
  shell,
  webContents,
  type MenuItemConstructorOptions,
} from 'electron';
import type { WindowManager } from '../windows/manager';
import { displayUnderCursor, toDisplayLike } from '../windows/assistantController';
import type { PinMenuItem } from './pinMenu';
import type {
  PinWindow,
  PinWindows,
  RestoreWindow,
  StudioPlatform,
  StudioWindow,
  StudioWindows,
} from './platform';

/** A pin that never reports its first frame is shown anyway after this long. */
const PIN_SHOW_FALLBACK_MS = 1500;

/**
 * Hides the window that owns a web contents (it must not be in the screenshot it asked for) and
 * returns how to bring it back; null when the window is not on screen or is already gone.
 */
export function hideWindowOf(contentsId: number): RestoreWindow | null {
  const contents = webContents.fromId(contentsId);
  const win = contents ? BrowserWindow.fromWebContents(contents) : null;
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null;
  win.hide();
  return ({ focus }) => {
    if (win.isDestroyed()) return;
    if (focus) win.show();
    else win.showInactive();
  };
}

function toMenu(items: readonly PinMenuItem[]): MenuItemConstructorOptions[] {
  return items.map((item) => ({
    ...(item.label !== undefined ? { label: item.label } : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.click ? { click: () => item.click?.() } : {}),
    ...(item.submenu ? { submenu: toMenu(item.submenu) } : {}),
  }));
}

/** The Studio window as the controller sees it. */
export function createStudioWindows(windows: WindowManager): StudioWindows {
  const wrappers = new WeakMap<BrowserWindow, StudioWindow>();
  const wrap = (win: BrowserWindow): StudioWindow => {
    const known = wrappers.get(win);
    if (known) return known;
    const wrapper: StudioWindow = {
      show: () => win.show(),
      hide: () => win.hide(),
      focus: () => win.focus(),
      isVisible: () => win.isVisible(),
      setBounds: (bounds) => win.setBounds(bounds),
      raise: () => {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      },
      onClosed: (listener) => {
        win.once('closed', listener);
      },
    };
    wrappers.set(win, wrapper);
    return wrapper;
  };
  return {
    ensure: () => wrap(windows.ensure('studio')),
    get: () => {
      const win = windows.get('studio');
      return win ? wrap(win) : undefined;
    },
    whenLoaded: () => windows.whenLoaded('studio'),
    sendSession: (session) => windows.send('studio', 'studio:session', session),
    sendCancel: (reason) => windows.send('studio', 'studio:cancel', { reason }),
    toast: (toast) => windows.send('assistant', 'toast:show', toast),
    destroy: () => windows.destroy('studio'),
  };
}

/** Pinned screenshots: one extra, frameless, always-on-top window each. */
export function createPinWindows(windows: WindowManager): PinWindows {
  return {
    create(bounds, query): PinWindow {
      const win = windows.createExtra('pin', { ...bounds, show: false }, query);
      win.setAlwaysOnTop(true, 'screen-saver');
      const webContentsId = win.webContents.id;
      let shown = false;
      const show = (): void => {
        if (shown || win.isDestroyed()) return;
        shown = true;
        // Pinning must not take the keyboard focus away from what the user was doing.
        win.showInactive();
      };
      win.once('ready-to-show', show);
      setTimeout(show, PIN_SHOW_FALLBACK_MS).unref();
      return {
        webContentsId,
        getBounds: () => win.getBounds(),
        setBounds: (next) => win.setBounds(next),
        setOpacity: (opacity) => win.setOpacity(opacity),
        setClickThrough: (enabled) => {
          // Forwarding keeps `mousemove` flowing to the page, which shows the unlock control.
          if (enabled) win.setIgnoreMouseEvents(true, { forward: true });
          else win.setIgnoreMouseEvents(false);
        },
        send: (info) => {
          if (!win.isDestroyed()) win.webContents.send('pin:update', info);
        },
        popupMenu: (items) => {
          if (!win.isDestroyed()) Menu.buildFromTemplate(toMenu(items)).popup({ window: win });
        },
        close: () => {
          if (!win.isDestroyed()) win.destroy();
        },
        onClosed: (listener) => {
          win.once('closed', listener);
        },
      };
    },
  };
}

/** Clipboard, dialogs, Explorer and notifications through Electron. */
export function createElectronPlatform(windows: WindowManager): StudioPlatform {
  return {
    cursorDisplay: () => toDisplayLike(displayUnderCursor()),
    displays: () => screen.getAllDisplays().map(toDisplayLike),
    isDark: () => nativeTheme.shouldUseDarkColors,
    onDisplayChange(listener) {
      screen.on('display-removed', listener);
      screen.on('display-metrics-changed', listener);
      return () => {
        screen.removeListener('display-removed', listener);
        screen.removeListener('display-metrics-changed', listener);
      };
    },
    writeClipboardImage: (png) =>
      clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]),
    writeClipboardText: (text) => clipboard.writeText(text),
    async showSaveDialog(defaultPath) {
      const options = {
        title: 'Save screenshot',
        defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
        properties: ['showOverwriteConfirmation' as const],
      };
      const parent = windows.get('studio');
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    trashItem: (path) => shell.trashItem(path),
    revealInFolder: (path) => shell.showItemInFolder(path),
    openFolder: async (path) => (await shell.openPath(path)) === '',
    openExternal: (url) => shell.openExternal(url),
    notify({ title, body, onClick }) {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body, silent: true });
      if (onClick) notification.on('click', onClick);
      notification.show();
    },
  };
}

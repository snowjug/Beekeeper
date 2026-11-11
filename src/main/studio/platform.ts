/**
 * What Capture Studio needs from Electron, as plain interfaces: the controllers never import
 * `electron`, so unit tests drive them with small fakes. platform.electron.ts implements these.
 */
import type { Rect } from '@shared/geometry';
import type { PinInfo, StudioSession, ToastEvent } from '@shared/ipc/types';
import type { DisplayLike } from '../windows/placement';
import type { PinMenuItem } from './pinMenu';

export type DisplayInfo = DisplayLike;

/** The Studio overlay window (one at a time; created on demand and destroyed after a while idle). */
export interface StudioWindow {
  show(): void;
  hide(): void;
  focus(): void;
  isVisible(): boolean;
  setBounds(bounds: Rect): void;
  /** Keeps the overlay above full-screen apps and the taskbar. */
  raise(): void;
  onClosed(listener: () => void): void;
}

export interface StudioWindows {
  /** The window, created hidden (and loading its page) when it does not exist yet. */
  ensure(): StudioWindow;
  get(): StudioWindow | undefined;
  whenLoaded(): Promise<void>;
  sendSession(session: StudioSession): void;
  sendCancel(reason: 'escape' | 'blur' | 'api' | 'display-change'): void;
  /** Toast in the assistant window (it may be hidden, so callers also notify). */
  toast(toast: ToastEvent): void;
  destroy(): void;
}

/** One pinned screenshot window. */
export interface PinWindow {
  readonly webContentsId: number;
  getBounds(): Rect;
  setBounds(bounds: Rect): void;
  setOpacity(opacity: number): void;
  /** Mouse events pass through the window (the page still sees the pointer move). */
  setClickThrough(enabled: boolean): void;
  send(info: PinInfo): void;
  popupMenu(items: PinMenuItem[]): void;
  close(): void;
  onClosed(listener: () => void): void;
}

export interface PinWindows {
  /** Creates the window at `bounds`, loads the pin page with `query` and shows it without focus. */
  create(bounds: Rect, query: string): PinWindow;
}

export interface Notice {
  title: string;
  body: string;
  /** Called when the user clicks the notification. */
  onClick?: () => void;
}

/** Brings back a window that stepped aside for a screenshot; `focus` also gives it the keyboard focus. */
export type RestoreWindow = (options: { focus: boolean }) => void;

export interface StudioPlatform {
  /** The display the user is working on: the one under the mouse cursor. */
  cursorDisplay(): DisplayInfo;
  displays(): DisplayInfo[];
  isDark(): boolean;
  /** Calls `listener` when a display is removed or changes size or scale. Returns the unsubscribe function. */
  onDisplayChange(listener: () => void): () => void;
  writeClipboardImage(png: Buffer): Promise<void>;
  writeClipboardText(text: string): Promise<void>;
  /** Save dialog parented to the Studio window; null when the user cancels. */
  showSaveDialog(defaultPath: string): Promise<string | null>;
  trashItem(path: string): Promise<void>;
  revealInFolder(path: string): void;
  /** Opens a folder in Explorer; false when Windows could not. */
  openFolder(path: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  notify(notice: Notice): void;
}

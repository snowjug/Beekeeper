import type { BrowserWindow } from 'electron';
import type { SETTINGS_PAGES } from '@shared/ipc/schemas';
import { displayUnderCursor, toDisplayLike } from './assistantController';
import type { WindowManager } from './manager';
import { computeCenteredBounds } from './placement';

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

const SIZES = {
  settings: { width: 1020, height: 720 },
  onboarding: { width: 900, height: 660 },
} as const;

/** Opens the framed windows (Settings, Onboarding) centred on the display under the cursor. */
export class WindowOpeners {
  /** `onCreated` runs when a window is created, so the caller can push the state it missed. */
  constructor(
    private readonly windows: WindowManager,
    private readonly onCreated: (role: 'settings' | 'onboarding') => void = () => undefined,
  ) {}

  openSettings(section?: SettingsPage): void {
    const alreadyOpen = this.windows.get('settings') !== undefined;
    const win = this.windows.ensure('settings', section ? `section=${section}` : '');
    if (!alreadyOpen) this.onCreated('settings');
    if (alreadyOpen && section) this.windows.send('settings', 'settings:navigate', { section });
    this.present(win, 'settings');
  }

  openOnboarding(): void {
    const alreadyOpen = this.windows.get('onboarding') !== undefined;
    const win = this.windows.ensure('onboarding');
    if (!alreadyOpen) this.onCreated('onboarding');
    this.present(win, 'onboarding');
  }

  close(role: 'settings' | 'onboarding' | 'circle'): void {
    this.windows.get(role)?.close();
  }

  private present(win: BrowserWindow, role: keyof typeof SIZES): void {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) {
      const bounds = computeCenteredBounds(toDisplayLike(displayUnderCursor()), SIZES[role]);
      win.setBounds(bounds);
      win.show();
    }
    win.focus();
    // Keep native caption buttons readable in either theme.
    this.windows.updateTitleBarOverlays();
  }
}

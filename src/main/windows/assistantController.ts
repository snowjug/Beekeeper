import { screen, type Display } from 'electron';
import type { Logger } from '@shared/logger';
import type { AssistantShowEvent } from '@shared/ipc/types';
import { computeAssistantBounds, pickDisplay, type DisplayLike } from './placement';
import type { WindowManager } from './manager';

export function toDisplayLike(display: Display): DisplayLike {
  return {
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  };
}

/** The display the user is working on: the one under the mouse cursor. */
export function displayUnderCursor(): Display {
  const displays = screen.getAllDisplays();
  const like = pickDisplay(displays.map(toDisplayLike), screen.getCursorScreenPoint());
  return displays.find((display) => display.id === like.id) ?? screen.getPrimaryDisplay();
}

const HIDE_FALLBACK_MS = 700;
const BLUR_GRACE_MS = 350;

export interface AssistantControllerDeps {
  windows: WindowManager;
  logger: Logger;
  /** Hide the bar when it loses focus. Automated tests turn this off (other windows steal focus). */
  hideOnBlur?: boolean;
}

/**
 * Shows / hides the assistant bar. The window is pre-created hidden so the hotkey only has to
 * move + show it (spec 7: hotkey to bar visible < 150 ms). Hiding is a two-step handshake: the
 * renderer plays its reverse animation, then acknowledges; a timer hides the window anyway.
 */
export class AssistantController {
  private visible = false;
  private pinned = false;
  private suspended = false;
  private shownAt = 0;
  private hideTimer: NodeJS.Timeout | null = null;
  private readonly visibilityListeners = new Set<(visible: boolean) => void>();

  constructor(private readonly deps: AssistantControllerDeps) {}

  /** Calls `listener` whenever the bar appears or disappears. Returns the unsubscribe function. */
  onVisibility(listener: (visible: boolean) => void): () => void {
    this.visibilityListeners.add(listener);
    return () => {
      this.visibilityListeners.delete(listener);
    };
  }

  private notifyVisibility(visible: boolean): void {
    for (const listener of this.visibilityListeners) listener(visible);
  }

  /** Creates the hidden window early. Safe to call repeatedly. */
  preload(): void {
    const win = this.deps.windows.ensure('assistant');
    if (win.listenerCount('blur') === 0) {
      win.on('blur', () => {
        if (this.deps.hideOnBlur === false) return;
        if (!this.visible || this.pinned || this.suspended) return;
        if (Date.now() - this.shownAt < BLUR_GRACE_MS) return;
        this.hide('blur');
      });
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  isPinned(): boolean {
    return this.pinned;
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned;
  }

  show(event: AssistantShowEvent): void {
    this.preload();
    const win = this.deps.windows.ensure('assistant');
    const display = displayUnderCursor();
    const bounds = computeAssistantBounds(toDisplayLike(display));
    // Moving between monitors with different scaling needs two passes on Windows.
    win.setBounds(bounds);
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, 'pop-up-menu');

    this.clearHideTimer();
    this.visible = true;
    this.pinned = false;
    this.shownAt = Date.now();
    win.show();
    win.focus();
    this.deps.windows.send('assistant', 'assistant:show', event);
    this.notifyVisibility(true);
  }

  toggle(source: AssistantShowEvent['source']): void {
    if (this.visible) this.hide('hotkey');
    else this.show({ listen: true, source });
  }

  hide(reason: 'blur' | 'hotkey' | 'escape' | 'api' = 'api'): void {
    if (!this.visible) return;
    this.visible = false;
    this.pinned = false;
    this.deps.windows.send('assistant', 'assistant:hide', { reason });
    this.notifyVisibility(false);
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => this.finishHide(), HIDE_FALLBACK_MS);
  }

  /** The renderer finished its exit animation. */
  acknowledgeHidden(): void {
    if (!this.visible) this.finishHide();
  }

  /**
   * Hides the bar at once, without its exit animation (e.g. before a screenshot must not contain
   * it). Returns true when the bar was on screen.
   */
  hideImmediately(): boolean {
    const win = this.deps.windows.get('assistant');
    const wasShown = this.visible || Boolean(win?.isVisible());
    if (!wasShown) return false;
    this.visible = false;
    this.pinned = false;
    this.clearHideTimer();
    this.deps.windows.send('assistant', 'assistant:hide', { reason: 'api' });
    win?.hide();
    this.notifyVisibility(false);
    return true;
  }

  /**
   * Takes the bar off the screen without ending the session (a screenshot must not contain it);
   * resume() brings it back. Returns true when the bar was on screen.
   */
  suspend(): boolean {
    const win = this.deps.windows.get('assistant');
    if (!this.visible || !win?.isVisible()) return false;
    this.suspended = true;
    win.hide();
    return true;
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    const win = this.deps.windows.get('assistant');
    if (!this.visible || !win) return;
    win.show();
    win.focus();
  }

  /** Re-centres the bar after display changes (monitor plugged/unplugged, DPI change). */
  reposition(): void {
    if (!this.visible) return;
    const win = this.deps.windows.get('assistant');
    if (!win) return;
    const bounds = computeAssistantBounds(toDisplayLike(displayUnderCursor()));
    win.setBounds(bounds);
    win.setBounds(bounds);
  }

  private finishHide(): void {
    this.clearHideTimer();
    if (this.visible) return;
    const win = this.deps.windows.get('assistant');
    if (win?.isVisible()) win.hide();
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}

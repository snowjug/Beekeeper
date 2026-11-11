import { screen, type BrowserWindow } from 'electron';
import type { DictationStart, DictationStatus } from '@shared/ipc/types';
import type { ForegroundApi, WindowRef } from '../system/foreground';
import type { WindowManager } from '../windows/manager';
import { computePillBounds, type Box } from './placement';
import type { DictationPill } from './types';

/** Size of the pill window (set by the window manager: 360 x 84 DIPs). */
const PILL_SIZE = { width: 360, height: 84 };
/** A page that has not reported ready by now did not load. */
const READY_TIMEOUT_MS = 8000;
/** A hidden pill window holds a renderer; let go of it when dictation is not being used. */
const IDLE_DESTROY_MS = 120_000;

export interface PillWindowDeps {
  windows: WindowManager;
  /** The Win32 helpers (for the caret and the window rectangle); null when unavailable. */
  foreground: () => Promise<ForegroundApi | null>;
  idleDestroyMs?: number;
}

/**
 * The dictation pill: a small always-on-top window that is shown without taking the keyboard
 * focus away from the app being dictated into. It is created when first needed, placed next to
 * the text caret (or at the bottom of the display) and destroyed again after a quiet spell.
 */
export class PillWindow implements DictationPill {
  private readyWindow: BrowserWindow | null = null;
  private readonly waiters = new Set<(ready: BrowserWindow) => void>();
  private readonly watched = new WeakSet<BrowserWindow>();
  private showToken = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: PillWindowDeps) {}

  /** The pill page loaded and subscribed to its events (`dictation:ready`). */
  markReady(): void {
    const win = this.deps.windows.get('dictation');
    if (!win) return;
    this.readyWindow = win;
    for (const waiter of [...this.waiters]) waiter(win);
  }

  async show(target: WindowRef | null): Promise<void> {
    const token = ++this.showToken;
    this.clearIdleTimer();
    const win = this.deps.windows.ensure('dictation');
    this.watch(win);
    await this.whenReady(win);
    if (token !== this.showToken || win.isDestroyed()) return;

    const bounds = await this.boundsFor(target);
    // hide() or destroy() may have been called while the page was loading.
    if (token !== this.showToken || win.isDestroyed()) return;
    // Moving between monitors with different scaling needs two passes on Windows.
    win.setBounds(bounds);
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.showInactive();
  }

  start(payload: DictationStart): void {
    this.deps.windows.send('dictation', 'dictation:start', payload);
  }

  stop(submit: boolean): void {
    this.deps.windows.send('dictation', 'dictation:stop', { submit });
  }

  status(status: DictationStatus): void {
    this.deps.windows.send('dictation', 'dictation:status', status);
  }

  hide(): void {
    this.showToken += 1;
    const win = this.deps.windows.get('dictation');
    if (win?.isVisible()) win.hide();
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const idle = this.deps.windows.get('dictation');
      if (idle && !idle.isVisible()) this.destroy();
    }, this.deps.idleDestroyMs ?? IDLE_DESTROY_MS);
    this.idleTimer.unref();
  }

  destroy(): void {
    this.showToken += 1;
    this.clearIdleTimer();
    this.readyWindow = null;
    this.deps.windows.destroy('dictation');
  }

  private watch(win: BrowserWindow): void {
    if (this.watched.has(win)) return;
    this.watched.add(win);
    win.once('closed', () => {
      if (this.readyWindow === win) this.readyWindow = null;
    });
  }

  private whenReady(win: BrowserWindow): Promise<void> {
    if (this.readyWindow === win) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error('The dictation window did not load in time'));
      }, READY_TIMEOUT_MS);
      const waiter = (ready: BrowserWindow): void => {
        if (ready !== win) return;
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve();
      };
      this.waiters.add(waiter);
    });
  }

  /** Next to the caret when the app has one, else at the bottom of the display it is on. */
  private async boundsFor(target: WindowRef | null): Promise<Box> {
    const foreground = target ? await this.deps.foreground() : null;
    const caretPixels = target && foreground ? foreground.caretRect(target) : null;
    const windowPixels = target && foreground ? foreground.windowRect(target) : null;

    let caret: Box | null = null;
    if (caretPixels) {
      const topLeft = screen.screenToDipPoint({ x: caretPixels.x, y: caretPixels.y });
      const bottomRight = screen.screenToDipPoint({
        x: caretPixels.x + caretPixels.width,
        y: caretPixels.y + caretPixels.height,
      });
      caret = {
        x: topLeft.x,
        y: topLeft.y,
        width: Math.max(1, bottomRight.x - topLeft.x),
        height: Math.max(1, bottomRight.y - topLeft.y),
      };
    }
    const anchor = caret
      ? { x: caret.x, y: caret.y }
      : windowPixels
        ? screen.screenToDipPoint({
            x: windowPixels.x + windowPixels.width / 2,
            y: windowPixels.y + windowPixels.height / 2,
          })
        : screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(anchor);
    return computePillBounds({ size: PILL_SIZE, work: display.workArea, caret });
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

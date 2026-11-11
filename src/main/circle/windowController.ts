import { nativeImage, screen, type BrowserWindow, type Display } from 'electron';
import type { Logger } from '@shared/logger';
import type { CircleSession, ToastEvent } from '@shared/ipc/types';
import { captureDisplay } from '../capture/screen';
import type { WindowManager } from '../windows/manager';
import { displayUnderCursor } from '../windows/assistantController';
import type { CircleCapture, CircleService } from './service';

type CancelReason = 'hotkey' | 'blur' | 'display-change' | 'api';
type Phase = 'idle' | 'starting' | 'open' | 'closing';

export interface CircleWindowDeps {
  windows: WindowManager;
  service: CircleService;
  logger: Logger;
  /** Hides the assistant bar and the edge glow at once so they are not part of the screenshot. */
  clearScreen: () => boolean;
  /** Tells the user something went wrong (the assistant bar may be hidden, so use a notification). */
  notify: (toast: Pick<ToastEvent, 'title' | 'message'>) => void;
  /** Cancel when the overlay loses focus. Automated tests turn this off (other windows steal focus). */
  cancelOnBlur?: boolean;
  /** Destroy the idle overlay window after this long (it costs about 35 MB). Default 2 minutes. */
  idleDestroyMs?: number;
}

/** The renderer must confirm that the frozen frame is decoded before the overlay is shown. */
const READY_TIMEOUT_MS = 2500;
/** Safety net when the renderer does not acknowledge the exit animation. */
const CLOSE_FALLBACK_MS = 500;
/** Focus loss right after showing is usually Windows settling; ignore it briefly. */
const BLUR_GRACE_MS = 600;
/** The assistant bar needs a frame or two to disappear from the desktop composition. */
const SCREEN_SETTLE_MS = 70;
/** A hidden overlay window holds a renderer and GPU surfaces: let go of it when it was not used. */
const IDLE_DESTROY_MS = 120_000;

interface ReadyWaiter {
  id: string;
  settle: (ready: boolean) => void;
}

/**
 * Lifecycle of the Circle to Search overlay window: capture -> show -> close. The window is created
 * when the hotkey is pressed (in parallel with the 40 ms screenshot, about 230 ms in total on a cold
 * start) and then kept hidden so the next use only has to size, show and focus it (about 90 ms,
 * spec 7: < 400 ms). After two idle minutes it is destroyed again, which keeps the idle memory low.
 * Every exit path funnels through finishClose(), which hides the window and frees the capture, so the
 * overlay can never linger as a ghost window.
 */
export class CircleWindowController {
  private phase: Phase = 'idle';
  private readyWaiter: ReadyWaiter | null = null;
  private closeTimer: NodeJS.Timeout | null = null;
  private blurTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private shownAt = 0;
  private wiredWindow: BrowserWindow | null = null;
  private screenWired = false;

  constructor(private readonly deps: CircleWindowDeps) {}

  isOpen(): boolean {
    return this.phase === 'open' || this.phase === 'starting';
  }

  /** Creates the hidden window (or finds it) and wires its events once per window. */
  preload(): void {
    const win = this.deps.windows.ensure('circle');
    if (this.wiredWindow !== win) {
      this.wiredWindow = win;
      win.on('blur', () => this.onBlur());
      win.on('focus', () => this.clearBlurTimer());
    }
    if (this.screenWired) return;
    this.screenWired = true;
    const onDisplayChange = (): void => {
      if (this.phase === 'open') this.cancel('display-change');
    };
    screen.on('display-removed', onDisplayChange);
    screen.on('display-metrics-changed', onDisplayChange);
  }

  /** Hotkey / tray / voice trigger: opens the overlay, or cancels it when it is already open. */
  async toggle(source: string): Promise<void> {
    if (this.phase === 'open') {
      this.cancel('hotkey');
      return;
    }
    if (this.phase !== 'idle') return;

    const started = performance.now();
    this.phase = 'starting';
    this.clearIdleTimer();
    try {
      // Start creating the window while the screenshot is taken.
      this.preload();
      const display = displayUnderCursor();
      if (this.deps.clearScreen()) await new Promise((done) => setTimeout(done, SCREEN_SETTLE_MS));
      const capture = await captureDisplay(display, screen.getAllDisplays(), this.deps.logger);
      const session = this.deps.service.register({
        image: capture.image,
        width: capture.width,
        height: capture.height,
        scaleFactor: capture.scaleFactor,
        display: { id: display.id, bounds: display.bounds },
      });
      const captured = Math.round(performance.now() - started);
      await this.present(session, display);
      this.deps.logger.info(
        `Circle to Search (${source}): ${capture.width}x${capture.height} captured in ${captured} ms, overlay visible after ${Math.round(performance.now() - started)} ms`,
      );
    } catch (error) {
      this.fail(error);
    }
  }

  /** Opens the overlay on an existing PNG instead of the live screen (automated tests). */
  async openWithImage(png: Buffer, display: Display = displayUnderCursor()): Promise<void> {
    if (this.phase !== 'idle') this.finishClose();
    this.phase = 'starting';
    try {
      const image = nativeImage.createFromBuffer(png);
      const size = image.getSize();
      const capture: CircleCapture = {
        image,
        width: size.width,
        height: size.height,
        scaleFactor: display.scaleFactor,
        display: { id: display.id, bounds: display.bounds },
      };
      await this.present(this.deps.service.register(capture), display);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Starts the exit: the renderer plays its reverse animation and then confirms via acknowledgeClosed(). */
  cancel(reason: CancelReason): void {
    if (this.phase === 'idle' || this.phase === 'closing') return;
    if (this.phase === 'starting') {
      this.finishClose();
      return;
    }
    this.phase = 'closing';
    this.deps.windows.send('circle', 'circle:cancel', { reason });
    this.closeTimer = setTimeout(() => this.finishClose(), CLOSE_FALLBACK_MS);
  }

  /** The renderer finished its exit animation (or closed itself, e.g. after "Search"). */
  acknowledgeClosed(): void {
    if (this.phase !== 'idle') this.finishClose();
  }

  markReady(sessionId: string): void {
    if (this.readyWaiter?.id === sessionId) this.readyWaiter.settle(true);
  }

  private async present(session: CircleSession, display: Display): Promise<void> {
    this.preload();
    const win = this.deps.windows.ensure('circle');
    await this.deps.windows.whenLoaded('circle');

    win.setBounds(display.bounds);
    win.setBounds(display.bounds);
    win.setAlwaysOnTop(true, 'screen-saver');

    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.readyWaiter = null;
        resolve(false);
      }, READY_TIMEOUT_MS);
      this.readyWaiter = {
        id: session.id,
        settle: (value) => {
          clearTimeout(timer);
          this.readyWaiter = null;
          resolve(value);
        },
      };
    });
    this.deps.windows.send('circle', 'circle:session', session);
    const isReady = await ready;

    if (this.phase !== 'starting') return;
    if (!isReady) throw new Error('The overlay did not respond in time.');
    win.show();
    win.focus();
    this.phase = 'open';
    this.shownAt = Date.now();
  }

  private onBlur(): void {
    if (this.phase !== 'open' || this.deps.cancelOnBlur === false) return;
    const wait = Math.max(150, BLUR_GRACE_MS - (Date.now() - this.shownAt));
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      const win = this.deps.windows.get('circle');
      if (this.phase === 'open' && win && !win.isFocused()) this.cancel('blur');
    }, wait);
  }

  private fail(error: unknown): void {
    this.deps.logger.error('Circle to Search failed to start', error);
    this.deps.notify({
      title: 'Circle to Search could not start',
      message: error instanceof Error ? error.message : 'Windows did not allow a screenshot.',
    });
    this.finishClose();
  }

  private clearBlurTimer(): void {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleDestroy(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.phase === 'idle') this.deps.windows.destroy('circle');
    }, this.deps.idleDestroyMs ?? IDLE_DESTROY_MS);
  }

  private finishClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.clearBlurTimer();
    this.readyWaiter?.settle(false);
    this.phase = 'idle';
    const win = this.deps.windows.get('circle');
    if (win?.isVisible()) win.hide();
    this.deps.service.end();
    if (win) this.scheduleIdleDestroy();
  }
}

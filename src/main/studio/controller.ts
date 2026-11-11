import { randomUUID } from 'node:crypto';
import { win32 } from 'node:path';
import type { Logger } from '@shared/logger';
import type { StudioSession, StudioSource } from '@shared/ipc/types';
import { APP_ORIGIN } from '@shared/windows';
import type { CaptureStore } from '../capture/store';
import { isPngPath, type StudioFs } from './files';
import { readPngSize } from './png';
import type {
  DisplayInfo,
  RestoreWindow,
  StudioPlatform,
  StudioWindow,
  StudioWindows,
} from './platform';
import {
  StudioError,
  type SessionAccess,
  type SessionRecord,
  type StudioSettings,
} from './session';

export interface StudioControllerDeps {
  windows: StudioWindows;
  platform: Pick<
    StudioPlatform,
    | 'cursorDisplay'
    | 'isDark'
    | 'onDisplayChange'
    | 'writeClipboardImage'
    | 'revealInFolder'
    | 'notify'
  >;
  settings: () => StudioSettings;
  captures: Pick<CaptureStore, 'put' | 'delete'>;
  /** Screenshot of the display under the cursor without Beekeeper's overlays. */
  captureScreen: () => Promise<{ png: Buffer; width: number; height: number }>;
  fs: Pick<StudioFs, 'readFile'>;
  /** Writes a PNG into the screenshots folder with a free "Beekeeper <date> <time>.png" name. */
  saveNew: (png: Buffer) => Promise<string>;
  logger: Logger;
  newId?: () => string;
  now?: () => number;
  /** Destroy the idle (hidden) window after this long. Default one minute. */
  idleDestroyMs?: number;
}

type Phase = 'idle' | 'capturing' | 'opening' | 'open' | 'closing';

/** The preview reports that the image is decoded; the window is shown only then. */
const READY_TIMEOUT_MS = 3000;
/** Safety net when the page does not acknowledge its exit animation. */
const CLOSE_FALLBACK_MS = 500;
/** The overlay needs a frame or two to leave the desktop composition before a new capture. */
const SCREEN_SETTLE_MS = 70;
/** A hidden window still holds a renderer: let go of it when it was not used. */
const IDLE_DESTROY_MS = 60_000;
/** The capture stays available to the page for as long as the preview is open. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** "Beekeeper\Beekeeper 2026-11-11 13.45.12.png": the folder and file name, short enough for a toast. */
export function shortPath(path: string): string {
  return win32.join(win32.basename(win32.dirname(path)), win32.basename(path));
}

/**
 * Lifecycle of the Capture Studio overlay: capture -> create the session -> save / copy as the
 * settings say -> show the window -> close. The window is created on demand, hidden when closed and
 * destroyed after a minute without use. Every start bumps `generation`; a flow that finds itself
 * superseded (a newer capture, a close) stops quietly, so the overlay can never be left half open.
 */
export class StudioController implements SessionAccess {
  private phase: Phase = 'idle';
  private session: SessionRecord | null = null;
  private generation = 0;
  private ready: { id: string; settle: (ok: boolean) => void } | null = null;
  private closeTimer: NodeJS.Timeout | null = null;
  private dismissTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private stopDisplayWatch: (() => void) | null = null;
  private watched: StudioWindow | null = null;
  private dismissMs = 0;
  private busy = false;

  constructor(private readonly deps: StudioControllerDeps) {}

  get isOpen(): boolean {
    return this.phase === 'open' || this.phase === 'opening' || this.phase === 'closing';
  }

  current(): SessionRecord | null {
    return this.session;
  }

  /** The session the page may load: nothing until it was sent to the page. */
  describeCurrent(): StudioSession | null {
    return this.session?.published ? this.describe(this.session) : null;
  }

  require(sessionId: string): SessionRecord {
    const record = this.session;
    if (!record || record.id !== sessionId || this.phase === 'idle' || this.phase === 'capturing') {
      throw new StudioError('This screenshot is no longer open.');
    }
    return record;
  }

  // ---- starting a session --------------------------------------------------------------------

  /**
   * Captures the display under the cursor and opens the Studio (or saves it, per the settings).
   * `stepAside` hides the window that asked for the capture (Settings) so it is not in the picture;
   * it comes back as soon as the screen is grabbed.
   */
  async capture(source: StudioSource, stepAside?: () => RestoreWindow | null): Promise<void> {
    if (this.phase === 'capturing') return;
    const hadWindow = this.discard();
    const token = this.generation;
    this.phase = 'capturing';
    const restore = this.hideRequester(stepAside);
    let restored = false;
    const bringBack = (focus: boolean): void => {
      if (restored || !restore) return;
      restored = true;
      try {
        restore({ focus });
      } catch (error) {
        this.deps.logger.warn('Bringing the window back after the capture failed', error);
      }
    };
    try {
      const settings = this.deps.settings();
      const display = this.deps.platform.cursorDisplay();
      // The page loads while the screen is captured.
      if (settings.capture.openStudio) this.deps.windows.ensure();
      if (hadWindow || restore) await sleep(SCREEN_SETTLE_MS);
      const shot = await this.deps.captureScreen();
      // Behind the preview when there is one; without a preview the user stays where they were.
      bringBack(!settings.capture.openStudio);
      if (token !== this.generation) return;

      const record = this.newRecord(shot.png, shot, display, source, null);
      if (!settings.capture.openStudio) {
        await this.finishWithoutStudio(record, settings);
        if (token === this.generation) this.phase = 'idle';
        return;
      }
      await this.open(record, settings, token, [
        this.autoSave(record, settings),
        this.autoCopy(record, settings),
      ]);
    } catch (error) {
      bringBack(true);
      if (token === this.generation) this.fail(error);
    } finally {
      bringBack(false);
    }
  }

  private hideRequester(stepAside: (() => RestoreWindow | null) | undefined): RestoreWindow | null {
    if (!stepAside) return null;
    try {
      return stepAside();
    } catch (error) {
      this.deps.logger.warn('Hiding the window that asked for the capture failed', error);
      return null;
    }
  }

  /** Opens a screenshot that was already saved to disk (the "take a screenshot" command). */
  async openFile(
    shot: { path: string; width: number; height: number },
    source: StudioSource = 'voice',
  ): Promise<void> {
    const token = this.begin();
    try {
      if (!isPngPath(shot.path)) throw new StudioError('That screenshot file cannot be opened.');
      const png = await this.deps.fs.readFile(shot.path);
      const size = readPngSize(png);
      if (!size) throw new StudioError('That screenshot could not be read.');
      if (token !== this.generation) return;

      const settings = this.deps.settings();
      const record = this.newRecord(
        png,
        size,
        this.deps.platform.cursorDisplay(),
        source,
        shot.path,
      );
      const copied = this.autoCopy(record, settings);
      // The command that took the screenshot already told the user it was saved.
      if (!settings.capture.openStudio) {
        await copied;
        return;
      }
      await this.open(record, settings, token, [copied]);
    } catch (error) {
      if (token === this.generation) this.fail(error);
    }
  }

  /** Opens a PNG that is in memory (a Circle to Search selection); it is not saved or copied for the user. */
  async openImage(
    png: Buffer,
    _size: { width: number; height: number },
    source: StudioSource = 'circle',
  ): Promise<void> {
    const token = this.begin();
    try {
      const size = readPngSize(png);
      if (!size) throw new StudioError('That image could not be opened.');
      const record = this.newRecord(png, size, this.deps.platform.cursorDisplay(), source, null);
      await this.open(record, this.deps.settings(), token, []);
    } catch (error) {
      if (token === this.generation) this.fail(error);
    }
  }

  // ---- the page's side of the handshake ------------------------------------------------------

  /** The page decoded the image of `sessionId`. */
  markReady(sessionId: string): void {
    if (this.ready?.id === sessionId) this.ready.settle(true);
  }

  /** The page started its exit animation or finished it: the overlay can go away now. */
  acknowledgeClosed(sessionId: string): void {
    if (this.session?.id !== sessionId) return;
    if (this.phase === 'open' || this.phase === 'closing') this.finishClose();
  }

  /** Esc, a click outside or a screen change: the page plays its exit animation, then closes. */
  requestClose(reason: 'escape' | 'blur' | 'api' | 'display-change'): void {
    if (this.phase === 'idle' || this.phase === 'closing') return;
    if (this.phase !== 'open') {
      this.discard();
      return;
    }
    this.phase = 'closing';
    this.clearDismiss();
    this.deps.windows.sendCancel(reason);
    this.closeTimer = setTimeout(() => this.finishClose(), CLOSE_FALLBACK_MS);
  }

  /** The user is working (menus, editing...): `busy` pauses the auto-dismiss timer, otherwise it restarts. */
  touch(busy: boolean): void {
    this.busy = busy;
    this.armDismiss();
  }

  activity(): void {
    this.armDismiss();
  }

  /** Closes the overlay at once, without an exit animation. */
  dispose(): void {
    this.generation += 1;
    this.finishClose();
    this.clearIdle();
    this.deps.windows.destroy();
  }

  // ---- opening --------------------------------------------------------------------------------

  private begin(): number {
    this.discard();
    return this.generation;
  }

  /** Hides the overlay and frees the session at once; true when the overlay was on screen. */
  private discard(): boolean {
    this.generation += 1;
    const visible = this.deps.windows.get()?.isVisible() ?? false;
    this.finishClose();
    return visible;
  }

  private newRecord(
    png: Buffer,
    size: { width: number; height: number },
    display: DisplayInfo,
    source: StudioSource,
    originalPath: string | null,
  ): SessionRecord {
    return {
      id: (this.deps.newId ?? randomUUID)(),
      png,
      width: size.width,
      height: size.height,
      scaleFactor: display.scaleFactor,
      source,
      createdAt: (this.deps.now ?? Date.now)(),
      display,
      originalPath,
      editedPath: null,
      published: false,
    };
  }

  private async open(
    record: SessionRecord,
    settings: StudioSettings,
    token: number,
    tasks: Array<Promise<void>>,
  ): Promise<void> {
    this.phase = 'opening';
    this.session = record;
    this.deps.captures.put(record.id, record.png, 'image/png', SESSION_TTL_MS);
    this.clearIdle();
    const win = this.deps.windows.ensure();
    this.watch(win);
    await Promise.all([this.deps.windows.whenLoaded(), ...tasks]);
    if (token !== this.generation) return;

    const ready = this.waitReady(record.id);
    record.published = true;
    this.deps.windows.sendSession(this.describe(record, settings));
    const decoded = await ready;
    if (token !== this.generation) return;
    if (!decoded) throw new StudioError('The preview did not respond in time.');

    const area = record.display.workArea;
    // Moving between monitors with different scaling needs two passes on Windows.
    win.setBounds(area);
    win.setBounds(area);
    win.raise();
    win.show();
    win.focus();
    this.phase = 'open';
    this.dismissMs = settings.capture.dismissAfterSeconds * 1000;
    this.busy = false;
    this.stopDisplayWatch = this.deps.platform.onDisplayChange(() =>
      this.requestClose('display-change'),
    );
    this.armDismiss();
  }

  private waitReady(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ready = null;
        resolve(false);
      }, READY_TIMEOUT_MS);
      this.ready = {
        id,
        settle: (value) => {
          clearTimeout(timer);
          this.ready = null;
          resolve(value);
        },
      };
    });
  }

  private describe(
    record: SessionRecord,
    settings: StudioSettings = this.deps.settings(),
  ): StudioSession {
    return {
      id: record.id,
      imageUrl: `${APP_ORIGIN}/capture/${record.id}.png`,
      width: record.width,
      height: record.height,
      scaleFactor: record.scaleFactor,
      savedPath: record.originalPath,
      source: record.source,
      createdAt: record.createdAt,
      display: { id: record.display.id, bounds: record.display.bounds },
      aiAvailable: settings.aiAvailable,
      glowFrame: settings.capture.glowFrame,
      dismissAfterSeconds: settings.capture.dismissAfterSeconds,
      theme: this.deps.platform.isDark() ? 'dark' : 'light',
    };
  }

  // ---- saving and copying as the settings say ------------------------------------------------

  private async autoSave(record: SessionRecord, settings: StudioSettings): Promise<void> {
    if (!settings.capture.autoSave) return;
    try {
      record.originalPath = await this.deps.saveNew(record.png);
    } catch (error) {
      this.deps.logger.warn('Saving the capture failed', error);
      this.deps.platform.notify({
        title: 'Screenshot not saved',
        body: 'Beekeeper could not write the file. Use Save in the preview to pick another folder.',
      });
    }
  }

  private async autoCopy(record: SessionRecord, settings: StudioSettings): Promise<void> {
    if (!settings.capture.autoCopy) return;
    try {
      await this.deps.platform.writeClipboardImage(record.png);
    } catch (error) {
      this.deps.logger.warn('Copying the capture failed', error);
    }
  }

  /** "Open the preview" is off: save and/or copy silently and say so with a toast and a notification. */
  private async finishWithoutStudio(
    record: SessionRecord,
    settings: StudioSettings,
  ): Promise<void> {
    // Without a preview a capture that is neither saved nor copied would simply vanish.
    const wantSave = settings.capture.autoSave || !settings.capture.autoCopy;
    let path: string | null = null;
    let copied = false;
    if (wantSave) {
      try {
        path = await this.deps.saveNew(record.png);
      } catch (error) {
        this.deps.logger.warn('Saving the capture failed', error);
      }
    }
    if (settings.capture.autoCopy) {
      try {
        await this.deps.platform.writeClipboardImage(record.png);
        copied = true;
      } catch (error) {
        this.deps.logger.warn('Copying the capture failed', error);
      }
    }
    if (!path && !copied) {
      this.deps.platform.notify({
        title: 'Screenshot not saved',
        body: 'Beekeeper could not save or copy the screenshot.',
      });
      return;
    }
    const title =
      path && copied
        ? 'Screenshot saved and copied'
        : path
          ? 'Screenshot saved'
          : 'Screenshot copied';
    const message = path ? shortPath(path) : 'Paste it with Ctrl+V.';
    this.deps.windows.toast({ title, message, tone: 'success' });
    const saved = path;
    this.deps.platform.notify({
      title,
      body: message,
      ...(saved ? { onClick: () => this.deps.platform.revealInFolder(saved) } : {}),
    });
  }

  // ---- closing ----------------------------------------------------------------------------------

  private fail(error: unknown): void {
    this.deps.logger.error('Capture Studio failed to open', error);
    this.deps.platform.notify({
      title: 'Capture Studio could not open',
      body: error instanceof StudioError ? error.message : 'Windows did not allow a screenshot.',
    });
    this.finishClose();
  }

  private finishClose(): void {
    this.clearDismiss();
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.stopDisplayWatch?.();
    this.stopDisplayWatch = null;
    this.ready?.settle(false);
    const record = this.session;
    this.session = null;
    this.phase = 'idle';
    this.busy = false;
    if (record) this.deps.captures.delete(record.id);
    const win = this.deps.windows.get();
    if (win?.isVisible()) win.hide();
    if (win) this.scheduleIdleDestroy();
  }

  private armDismiss(): void {
    this.clearDismiss();
    if (this.phase !== 'open' || this.busy || this.dismissMs <= 0) return;
    this.dismissTimer = setTimeout(() => this.requestClose('api'), this.dismissMs);
  }

  private clearDismiss(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private scheduleIdleDestroy(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.phase === 'idle') this.deps.windows.destroy();
    }, this.deps.idleDestroyMs ?? IDLE_DESTROY_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** A window that is closed from outside (Alt+F4) must not leave the session half open. */
  private watch(win: StudioWindow): void {
    if (this.watched === win) return;
    this.watched = win;
    win.onClosed(() => {
      if (this.watched !== win) return;
      this.watched = null;
      if (this.phase !== 'idle') {
        this.generation += 1;
        this.finishClose();
      }
    });
  }
}

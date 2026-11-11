import { showToast } from '@renderer/components/Toast';
import { SpeechPlayer } from '@renderer/lib/voice/player';
import type { Bridge } from '@shared/ipc/bridge';
import type {
  StudioActionResult,
  StudioSession,
  StudioShareTarget,
  SynthesizeResult,
} from '@shared/ipc/types';
import { flattenToPng, type Flattener, type PngBytes } from './edit/flatten';
import {
  activeBoxes,
  boxesFromRegions,
  redactionOps,
  removeBox,
  toggleBox,
} from './edit/redaction';
import type { EditState } from './edit/types';
import { Shutter, type ShutterSound } from './shutter';
import { createStudioStore, isBusy, type ActionId, type MenuId, type StudioStore } from './store';

/** How long the check mark of a finished action stays. */
const FLASH_MS = 1400;
/** Safety net when the exit animation never reports back. */
const EXIT_FALLBACK_MS = 800;
/** The page tells main about activity at most this often. */
const ACTIVITY_INTERVAL_MS = 750;
/** The limit of the speech engine's input. */
const MAX_SPEECH_CHARS = 4000;
/** Pauses before the preview closes after an action that hands over to another app or window. */
const CLOSE_AFTER_TOAST_MS = 1400;
const CLOSE_AFTER_PIN_MS = 450;
const CLOSE_AFTER_DELETE_MS = 900;

export interface SpeechOutput {
  play(result: SynthesizeResult): Promise<void>;
  stop(): void;
  dispose(): Promise<void>;
}

export interface StudioControllerOptions {
  store?: StudioStore;
  flatten?: Flattener;
  player?: SpeechOutput;
  shutter?: ShutterSound;
  decode?: (url: string) => Promise<HTMLImageElement>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export async function decodeImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset['theme'] = theme;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Everything the Capture Studio page does besides drawing: it receives the capture from the main
 * process, runs the toolbar actions through the bridge (with busy / done states and toasts), owns
 * the edited picture and the exit handshake (reverse animation first, then `studio:close`).
 * Pure logic over a fake bridge and store in unit tests.
 */
export class StudioController {
  readonly store: StudioStore;
  private readonly flatten: Flattener;
  private readonly player: SpeechOutput;
  private readonly shutter: ShutterSound;
  private readonly decode: (url: string) => Promise<HTMLImageElement>;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;

  private sessionId: string | null = null;
  private closing: string | null = null;
  private image: HTMLImageElement | null = null;
  private editedPng: PngBytes | null = null;
  private objectUrl: string | null = null;
  private exitTimer: number | null = null;
  private readonly timers = new Set<number>();
  private textRequest = 0;
  private redactRequest = 0;
  private lastActivity = 0;
  private reportedBusy = false;

  constructor(
    private readonly bridge: Bridge<'studio'>,
    options: StudioControllerOptions = {},
  ) {
    this.store = options.store ?? createStudioStore();
    this.flatten = options.flatten ?? flattenToPng;
    this.player = options.player ?? new SpeechPlayer();
    this.shutter = options.shutter ?? new Shutter();
    this.decode = options.decode ?? decodeImage;
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  /** Subscribes to main-process events and loads the settings. Returns the cleanup function. */
  async start(): Promise<() => void> {
    const { bridge, store } = this;
    const offs = [
      bridge.on('studio:session', (session) => void this.onSession(session)),
      bridge.on('studio:cancel', () => this.beginExit()),
      bridge.on('settings:changed', (settings) => store.getState().setSettings(settings)),
      bridge.on('theme:changed', ({ theme }) => applyTheme(theme)),
    ];
    const unsubscribeBusy = store.subscribe(() => this.syncBusy());
    const [settings, pending] = await Promise.all([
      bridge.invoke('settings:get'),
      bridge.invoke('studio:getSession'),
    ]);
    store.getState().setSettings(settings);
    if (pending) void this.onSession(pending);
    return () => {
      for (const off of offs) off();
      unsubscribeBusy();
      this.releaseResources();
      this.shutter.dispose();
      void this.player.dispose();
    };
  }

  /** The decoded picture that is shown (edited or not): the editor draws from it. */
  get currentImage(): HTMLImageElement | null {
    return this.image;
  }

  // ---- session lifecycle ---------------------------------------------------------------------------

  /** A new capture: reset everything, decode the image, play the shutter and tell main it can show the window. */
  async onSession(session: StudioSession): Promise<void> {
    // The session may arrive twice: as an event and as the answer of studio:getSession.
    if (this.sessionId === session.id) return;
    this.releaseResources();
    this.sessionId = session.id;
    this.closing = null;
    const state = this.store.getState();
    state.reset();
    state.setSession(session);
    applyTheme(session.theme);

    let image: HTMLImageElement;
    try {
      image = await this.decode(session.imageUrl);
    } catch {
      await this.log('error', 'The screenshot could not be decoded');
      return;
    }
    if (this.sessionId !== session.id) return;
    this.image = image;
    const size = {
      width: image.naturalWidth || session.width,
      height: image.naturalHeight || session.height,
    };
    const next = this.store.getState();
    next.setImage(session.imageUrl, size, false);
    next.setVisible(true);
    next.announce('Screenshot ready. Use the toolbar below to edit, pin, copy, share or save it.');
    this.playShutter();
    await this.bridge.invoke('studio:ready', { sessionId: session.id }).catch(() => undefined);
  }

  /** Esc, a click outside or a request from main: play the exit animation, then close. */
  beginExit(): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    this.closing = sessionId;
    if (!this.store.getState().visible) {
      void this.acknowledgeClosed();
      return;
    }
    this.clearTimers();
    this.player.stop();
    this.store.getState().setVisible(false);
    this.store.getState().setMenu(null);
    this.exitTimer = window.setTimeout(() => void this.acknowledgeClosed(), EXIT_FALLBACK_MS);
  }

  /** The reverse animation finished: free everything and let main hide the window. */
  async acknowledgeClosed(): Promise<void> {
    const sessionId = this.sessionId;
    // A new capture may have replaced the one that was closing.
    if (!sessionId || this.closing !== sessionId) return;
    this.closing = null;
    this.sessionId = null;
    this.releaseResources();
    this.store.getState().reset();
    this.reportedBusy = false;
    await this.bridge.invoke('studio:close', { sessionId }).catch(() => undefined);
  }

  /** Called on pointer and keyboard activity; restarts the auto-dismiss timer in main. */
  noteActivity(): void {
    const now = Date.now();
    if (!this.sessionId || now - this.lastActivity < ACTIVITY_INTERVAL_MS) return;
    this.lastActivity = now;
    void this.bridge.invoke('studio:activity', { busy: this.reportedBusy }).catch(() => undefined);
  }

  private syncBusy(): void {
    if (!this.sessionId) return;
    const busy = isBusy(this.store.getState());
    if (busy === this.reportedBusy) return;
    this.reportedBusy = busy;
    void this.bridge.invoke('studio:activity', { busy }).catch(() => undefined);
  }

  private playShutter(): void {
    const settings = this.store.getState().settings;
    if (settings?.capture.shutterSound && settings.voice.earcons) this.shutter.play();
  }

  // ---- menus -----------------------------------------------------------------------------------------

  toggleMenu(menu: MenuId): void {
    const state = this.store.getState();
    state.setMenu(state.menu === menu ? null : menu);
  }

  closeMenu(): void {
    this.store.getState().setMenu(null);
  }

  // ---- toolbar actions ---------------------------------------------------------------------------------

  async copy(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const result = await this.perform('copy', () =>
      this.bridge.invoke('studio:copy', { sessionId: session.id, ...this.edited() }),
    );
    if (result?.ok) {
      showToast({ title: 'Copied to clipboard', tone: 'success' });
      this.store.getState().announce('Copied to clipboard');
    } else if (result) {
      this.failed('Could not copy the screenshot', result);
    }
  }

  async save(saveAs = false): Promise<void> {
    const session = this.session();
    if (!session) return;
    const result = await this.perform('save', () =>
      this.bridge.invoke('studio:save', {
        sessionId: session.id,
        ...(saveAs ? { saveAs: true } : {}),
        ...this.edited(),
      }),
    );
    if (!result) return;
    if (result.ok) {
      const place = result.path ? fileName(result.path) : undefined;
      showToast({
        title: 'Saved',
        ...(place ? { message: place } : {}),
        tone: 'success',
        action: { label: 'Show in folder', onClick: () => void this.share('reveal') },
      });
      this.store.getState().announce('Screenshot saved');
    } else if (result.message) {
      // A cancelled "Save as" dialog has no message and needs no toast.
      this.failed('Could not save the screenshot', result);
    }
  }

  async pin(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const result = await this.perform('pin', () =>
      this.bridge.invoke('studio:pin', { sessionId: session.id, ...this.edited() }),
    );
    if (result?.ok) {
      this.store.getState().announce('Pinned to your screen');
      this.closeAfter(CLOSE_AFTER_PIN_MS);
    } else if (result) {
      this.failed('Could not pin the screenshot', result);
    }
  }

  async setWallpaper(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const result = await this.perform('wallpaper', () =>
      this.bridge.invoke('studio:wallpaper', { sessionId: session.id, ...this.edited() }),
    );
    if (result?.ok) {
      showToast({
        title: 'Wallpaper updated',
        message: 'Your screenshot is now your desktop background.',
        tone: 'success',
      });
      this.store.getState().announce('Wallpaper updated');
    } else if (result) {
      this.failed('Could not set the wallpaper', result);
    }
  }

  async share(target: StudioShareTarget): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.closeMenu();
    const result = await this.perform('share', () =>
      this.bridge.invoke('studio:share', { sessionId: session.id, target, ...this.edited() }),
    );
    if (!result) return;
    if (!result.ok) {
      this.failed('Could not share the screenshot', result);
      return;
    }
    if (target === 'reveal' || target === 'openWith') {
      // The Explorer or dialog window opens behind this always-on-top preview: get out of its way.
      this.beginExit();
      return;
    }
    showToast(
      target === 'file'
        ? {
            title: 'Copied as a file',
            message: 'Paste it into a chat, an e-mail or a folder.',
            tone: 'success',
          }
        : {
            title: 'Screenshot copied',
            message: 'Paste it (Ctrl+V) into your e-mail.',
            tone: 'success',
          },
    );
    this.closeAfter(CLOSE_AFTER_TOAST_MS);
  }

  async deleteScreenshot(): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.closeMenu();
    const result = await this.perform('delete', () =>
      this.bridge.invoke('studio:delete', { sessionId: session.id }),
    );
    if (result?.ok) {
      showToast({ title: result.message ?? 'Moved to the Recycle Bin', tone: 'success' });
      this.closeAfter(CLOSE_AFTER_DELETE_MS);
    } else if (result) {
      this.failed('Could not delete the screenshot', result);
    }
  }

  async openFolder(): Promise<void> {
    this.closeMenu();
    try {
      const opened = await this.bridge.invoke('studio:openFolder');
      if (opened) this.beginExit();
      else showToast({ title: 'Could not open the folder', tone: 'error' });
    } catch {
      showToast({ title: 'Could not open the folder', tone: 'error' });
    }
  }

  /** Takes a new screenshot: main hides this preview first and opens a new one. */
  async recapture(): Promise<void> {
    this.closeMenu();
    try {
      await this.bridge.invoke('capture:start', {});
    } catch {
      showToast({ title: 'Could not take a new screenshot', tone: 'error' });
    }
  }

  async openSettings(): Promise<void> {
    this.closeMenu();
    try {
      await this.bridge.invoke('window:openSettings', { section: 'capture' });
    } catch {
      showToast({ title: 'Could not open Settings', tone: 'error' });
      return;
    }
    // Settings opens behind this always-on-top preview.
    this.beginExit();
  }

  // ---- Photo assist --------------------------------------------------------------------------------------

  /** Reads the text of the picture into the bottom sheet. */
  async extractText(): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.closeMenu();
    const request = ++this.textRequest;
    this.store.getState().setSheet({
      open: true,
      status: 'loading',
      text: '',
      message: '',
      speaking: false,
    });
    this.player.stop();
    try {
      const result = await this.bridge.invoke('studio:assist', {
        sessionId: session.id,
        task: 'text',
        ...this.edited(),
      });
      if (request !== this.textRequest) return;
      const sheet = this.store.getState();
      if (result.ok) {
        sheet.setSheet({ status: 'done', text: result.text ?? '', message: result.message ?? '' });
        sheet.announce(result.text ? 'Text found' : (result.message ?? 'No text found'));
      } else {
        sheet.setSheet({
          status: 'error',
          message: result.message ?? 'The text could not be read.',
        });
      }
    } catch {
      if (request !== this.textRequest) return;
      this.store.getState().setSheet({ status: 'error', message: 'The text could not be read.' });
    }
  }

  closeSheet(): void {
    this.textRequest += 1;
    this.player.stop();
    this.store.getState().setSheet({ open: false, speaking: false });
  }

  async copyText(): Promise<void> {
    const { text } = this.store.getState().sheet;
    if (text === '') return;
    try {
      const result = await this.bridge.invoke('studio:copyText', { text });
      if (result.ok)
        showToast({ title: 'Text copied', message: `${text.length} characters`, tone: 'success' });
      else this.failed('Could not copy the text', result);
    } catch {
      showToast({ title: 'Could not copy the text', tone: 'error' });
    }
  }

  async searchText(): Promise<void> {
    const text = this.store.getState().sheet.text.trim();
    if (text === '') return;
    try {
      const result = await this.bridge.invoke('studio:searchText', { text: text.slice(0, 1000) });
      if (result.ok) this.beginExit();
      else this.failed('Could not open the browser', result);
    } catch {
      showToast({ title: 'Could not open the browser', tone: 'error' });
    }
  }

  async toggleReadAloud(): Promise<void> {
    const { sheet } = this.store.getState();
    if (sheet.speaking) {
      this.player.stop();
      this.store.getState().setSheet({ speaking: false });
      return;
    }
    const text = sheet.text.trim();
    if (text === '') return;
    this.store.getState().setSheet({ speaking: true });
    try {
      const audio = await this.bridge.invoke('speech:synthesize', {
        text: text.slice(0, MAX_SPEECH_CHARS),
      });
      // Stopped, or the sheet closed, while the voice was being made.
      if (!this.store.getState().sheet.speaking) return;
      await this.player.play(audio);
    } catch {
      this.store.getState().setSheet({ readAloud: 'unavailable' });
    } finally {
      this.store.getState().setSheet({ speaking: false });
    }
  }

  /** Looks for personal data and shows boxes the user can review before anything is blurred. */
  async hideSensitive(): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.closeMenu();
    const size = this.store.getState().imageSize;
    if (!size) return;
    const request = ++this.redactRequest;
    this.store.getState().setRedaction({ status: 'loading', boxes: [] });
    try {
      const result = await this.bridge.invoke('studio:assist', {
        sessionId: session.id,
        task: 'sensitive',
        ...this.edited(),
      });
      if (request !== this.redactRequest) return;
      const boxes = boxesFromRegions(result.regions ?? [], size);
      if (!result.ok || boxes.length === 0) {
        this.store.getState().setRedaction({ status: 'idle', boxes: [] });
        showToast({
          title: result.ok ? 'No sensitive info found' : 'Could not look for sensitive info',
          message: result.message ?? 'Nothing here looks like an e-mail, phone, card or password.',
          tone: result.ok ? 'info' : 'error',
        });
        return;
      }
      this.store.getState().setRedaction({ status: 'review', boxes });
      this.store
        .getState()
        .announce(`${boxes.length} sensitive ${boxes.length === 1 ? 'area' : 'areas'} found`);
    } catch {
      if (request !== this.redactRequest) return;
      this.store.getState().setRedaction({ status: 'idle', boxes: [] });
      showToast({ title: 'Could not look for sensitive info', tone: 'error' });
    }
  }

  toggleRedaction(id: string): void {
    const { redaction } = this.store.getState();
    this.store.getState().setRedaction({ boxes: toggleBox(redaction.boxes, id) });
  }

  removeRedaction(id: string): void {
    const { redaction } = this.store.getState();
    const boxes = removeBox(redaction.boxes, id);
    this.store.getState().setRedaction(boxes.length === 0 ? { status: 'idle', boxes } : { boxes });
  }

  cancelRedaction(): void {
    this.redactRequest += 1;
    this.store.getState().setRedaction({ status: 'idle', boxes: [] });
  }

  /** Blurs the boxes that are still selected into the picture. */
  async applyRedaction(): Promise<void> {
    const image = this.image;
    const size = this.store.getState().imageSize;
    const boxes = activeBoxes(this.store.getState().redaction.boxes);
    if (!image || !size) return;
    if (boxes.length === 0) {
      this.cancelRedaction();
      return;
    }
    this.store.getState().setRedaction({ status: 'applying' });
    try {
      const png = await this.flatten(image, size, { ops: redactionOps(boxes, 1), crop: null });
      await this.replaceImage(png);
      this.store.getState().setRedaction({ status: 'idle', boxes: [] });
      showToast({
        title: 'Sensitive info hidden',
        message: `${boxes.length} ${boxes.length === 1 ? 'area' : 'areas'} blurred. Save or copy to keep it.`,
        tone: 'success',
      });
    } catch {
      this.store.getState().setRedaction({ status: 'review' });
      showToast({ title: 'Could not hide the sensitive info', tone: 'error' });
    }
  }

  // ---- editing -------------------------------------------------------------------------------------------

  enterEdit(): void {
    if (!this.image) return;
    this.closeMenu();
    this.store.getState().setMode('edit');
  }

  cancelEdit(): void {
    this.store.getState().setMode('view');
  }

  /** Done: flatten the edits into a new picture (at native resolution) and show it. */
  async completeEdit(edit: EditState): Promise<void> {
    const image = this.image;
    const size = this.store.getState().imageSize;
    if (!image || !size) return;
    if (edit.ops.length === 0 && edit.crop === null) {
      this.cancelEdit();
      return;
    }
    this.store.getState().setAction('edit', 'busy');
    try {
      const png = await this.flatten(image, size, edit);
      await this.replaceImage(png);
      this.store.getState().setMode('view');
      this.store.getState().setAction('edit', 'done');
      this.after(FLASH_MS, () => this.store.getState().setAction('edit', 'idle'));
      this.store.getState().announce('Changes applied. Save or copy to keep them.');
    } catch {
      this.store.getState().setAction('edit', 'error');
      this.after(FLASH_MS, () => this.store.getState().setAction('edit', 'idle'));
      showToast({
        title: 'Could not apply the changes',
        message: 'Please try again.',
        tone: 'error',
      });
    }
  }

  // ---- helpers ---------------------------------------------------------------------------------------------

  /** The open session, or null when there is none. */
  private session(): StudioSession | null {
    return this.store.getState().session;
  }

  /** The edited PNG, as the optional part of a request. */
  private edited(): { png?: PngBytes } {
    return this.editedPng ? { png: this.editedPng } : {};
  }

  /** Runs a toolbar action with its busy / done / error state. Null when the call itself failed. */
  private async perform(
    id: ActionId,
    call: () => Promise<StudioActionResult>,
  ): Promise<StudioActionResult | null> {
    const state = this.store.getState();
    if (state.actions[id] === 'busy') return null;
    state.setAction(id, 'busy');
    try {
      const result = await call();
      // A cancelled dialog (ok: false without a message) goes back to idle.
      this.store.getState().setAction(id, result.ok ? 'done' : result.message ? 'error' : 'idle');
      this.after(FLASH_MS, () => this.store.getState().setAction(id, 'idle'));
      return result;
    } catch {
      this.store.getState().setAction(id, 'error');
      this.after(FLASH_MS, () => this.store.getState().setAction(id, 'idle'));
      showToast({ title: 'That did not work', message: 'Please try again.', tone: 'error' });
      return null;
    }
  }

  private failed(title: string, result: StudioActionResult): void {
    showToast({ title, ...(result.message ? { message: result.message } : {}), tone: 'error' });
  }

  /** Replaces the picture with an edited PNG and frees the previous edited picture. */
  private async replaceImage(png: PngBytes): Promise<void> {
    const url = this.createObjectUrl(new Blob([png], { type: 'image/png' }));
    let image: HTMLImageElement;
    try {
      image = await this.decode(url);
    } catch (error) {
      this.revokeObjectUrl(url);
      throw error;
    }
    if (this.objectUrl) this.revokeObjectUrl(this.objectUrl);
    this.objectUrl = url;
    this.image = image;
    this.editedPng = png;
    this.store
      .getState()
      .setImage(url, { width: image.naturalWidth, height: image.naturalHeight }, true);
  }

  private closeAfter(ms: number): void {
    this.after(ms, () => this.beginExit());
  }

  private after(ms: number, run: () => void): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    if (this.exitTimer !== null) {
      window.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }

  /** Frees what belongs to the screenshot: timers, speech, the edited picture and its object URL. */
  private releaseResources(): void {
    this.clearTimers();
    this.textRequest += 1;
    this.redactRequest += 1;
    this.player.stop();
    if (this.objectUrl) this.revokeObjectUrl(this.objectUrl);
    this.objectUrl = null;
    this.image = null;
    this.editedPng = null;
  }

  private async log(level: 'error' | 'warn', message: string): Promise<void> {
    await this.bridge.invoke('app:log', { level, scope: 'studio', message }).catch(() => undefined);
  }
}

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Point } from '@shared/geometry';
import type { Bridge } from '@shared/ipc/bridge';
import type { PinAction, PinInfo } from '@shared/ipc/types';
import { clampOpacity, clampScale, opacityFromWheel, stepScale, zoomFromWheel } from './zoom';

export type PinButton = 'copy' | 'save';
export type ButtonStatus = 'idle' | 'busy' | 'done' | 'error';

export interface PinState {
  /** `loading` until the main process answers; `missing` when it does not know this window. */
  status: 'loading' | 'ready' | 'missing';
  info: PinInfo | null;
  buttons: Record<PinButton, ButtonStatus>;
  /** The picture could not be loaded (for example its capture was already freed). */
  imageFailed: boolean;
}

export interface PinStateActions {
  showInfo: (info: PinInfo | null) => void;
  patchInfo: (patch: Partial<PinInfo>) => void;
  setButton: (button: PinButton, status: ButtonStatus) => void;
  failImage: () => void;
}

export type PinStore = UseBoundStore<StoreApi<PinState & PinStateActions>>;

/** One store per pin page (tests create their own). */
export function createPinStore(): PinStore {
  return create<PinState & PinStateActions>()((set) => ({
    status: 'loading',
    info: null,
    buttons: { copy: 'idle', save: 'idle' },
    imageFailed: false,
    showInfo: (info) =>
      set((state) =>
        info
          ? {
              status: 'ready',
              info,
              imageFailed: state.info?.imageUrl === info.imageUrl ? state.imageFailed : false,
            }
          : { status: 'missing', info: null },
      ),
    patchInfo: (patch) => set((state) => (state.info ? { info: { ...state.info, ...patch } } : {})),
    setButton: (button, status) =>
      set((state) => ({ buttons: { ...state.buttons, [button]: status } })),
    failImage: () => set({ imageFailed: true }),
  }));
}

export interface PinControllerOptions {
  store?: PinStore;
  /** Runs `callback` before the next frame (default: requestAnimationFrame); returns a canceller. */
  frame?: (callback: () => void) => () => void;
  /** How long a button keeps its "done" or "error" icon. */
  feedbackMs?: number;
}

export interface WheelInput {
  deltaY: number;
  deltaMode: number;
  /** Ctrl + wheel changes the opacity instead of the zoom. */
  ctrlKey: boolean;
  /** The pointer, in window DIPs: the zoom keeps this point still. */
  x: number;
  y: number;
}

const FEEDBACK_MS = 1400;

function nextFrame(callback: () => void): () => void {
  const id = window.requestAnimationFrame(callback);
  return () => window.cancelAnimationFrame(id);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset['theme'] = theme;
}

/**
 * The page of one pinned screenshot. The main process owns the window, so zoom, opacity and moves
 * are requests: the page applies them to its own state at once (so a fast wheel keeps compounding)
 * and sends at most one request per frame; the answer (`pin:update`) is the final word.
 */
export class PinController {
  readonly store: PinStore;
  private readonly frame: (callback: () => void) => () => void;
  private readonly feedbackMs: number;
  private unsubscribes: Array<() => void> = [];
  private cancelFrame: (() => void) | null = null;
  private pendingScale: { value: number; anchor?: Point } | null = null;
  private pendingOpacity: number | null = null;
  private pendingMove: Point | null = null;
  private readonly inflight = { scale: 0, opacity: 0 };
  private latest: PinInfo | null = null;
  private disposed = false;
  private readonly timers = new Map<PinButton, number>();

  constructor(
    private readonly bridge: Bridge<'pin'>,
    options: PinControllerOptions = {},
  ) {
    this.store = options.store ?? createPinStore();
    this.frame = options.frame ?? nextFrame;
    this.feedbackMs = options.feedbackMs ?? FEEDBACK_MS;
  }

  async start(): Promise<void> {
    this.unsubscribes = [
      this.bridge.on('pin:update', (info) => this.applyUpdate(info)),
      this.bridge.on('theme:changed', ({ theme }) => applyTheme(theme)),
    ];
    // The theme is cosmetic: until it arrives the page follows the system setting.
    const theme = this.bridge
      .invoke('app:info')
      .then((app) => applyTheme(app.theme))
      .catch(() => undefined);
    try {
      const info = await this.bridge.invoke('pin:getInfo');
      // An update that already arrived is newer than this answer.
      if (!this.disposed && this.latest === null) this.store.getState().showInfo(info);
    } catch (error) {
      this.store.getState().showInfo(null);
      await this.log('error', `pin:getInfo failed: ${messageOf(error)}`);
    }
    await theme;
  }

  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    this.cancelFrame?.();
    this.cancelFrame = null;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }

  copy(): Promise<void> {
    return this.run('copy', { type: 'copy' });
  }

  save(): Promise<void> {
    return this.run('save', { type: 'save' });
  }

  close(): void {
    void this.fire({ type: 'close' });
  }

  menu(): void {
    void this.fire({ type: 'menu' });
  }

  /** Moves the window so its top-left corner is at `target` (screen DIPs). */
  moveTo(target: Point): void {
    this.pendingMove = target;
    this.schedule();
  }

  zoomTo(requested: number, anchor?: Point): void {
    const info = this.store.getState().info;
    if (!info) return;
    const value = clampScale(requested);
    // Already at the limit: nothing to ask for.
    if (value === info.scale && this.pendingScale === null) return;
    this.store.getState().patchInfo({ scale: value });
    this.pendingScale = { value, ...(anchor ? { anchor } : {}) };
    this.schedule();
  }

  /** One keyboard zoom step around the pin's centre. */
  zoomStep(direction: 1 | -1): void {
    const info = this.store.getState().info;
    if (info) this.zoomTo(stepScale(info.scale, direction));
  }

  resetScale(): void {
    void this.fire({ type: 'resetScale' });
  }

  setOpacity(requested: number): void {
    if (!this.store.getState().info) return;
    const value = clampOpacity(requested);
    this.store.getState().patchInfo({ opacity: value });
    this.pendingOpacity = value;
    this.schedule();
  }

  wheel(input: WheelInput): void {
    const info = this.store.getState().info;
    if (!info) return;
    if (input.ctrlKey) {
      this.setOpacity(opacityFromWheel(info.opacity, input.deltaY, input.deltaMode));
    } else {
      this.zoomTo(zoomFromWheel(info.scale, input.deltaY, input.deltaMode), {
        x: input.x,
        y: input.y,
      });
    }
  }

  setClickThrough(value: boolean): void {
    this.store.getState().patchInfo({ clickThrough: value });
    void this.fire({ type: 'clickThrough', value });
  }

  /** While click-through is on: the pointer is over a control that must receive clicks. */
  setInteractive(value: boolean): void {
    void this.fire({ type: 'interactive', value });
  }

  imageFailed(): void {
    this.store.getState().failImage();
    void this.log('warn', 'The pinned image could not be loaded');
  }

  private applyUpdate(info: PinInfo): void {
    if (this.disposed) return;
    this.latest = info;
    const current = this.store.getState().info;
    // A zoom or opacity still on its way: the page's own value is newer than this update.
    const holdScale = this.inflight.scale > 0 || this.pendingScale !== null;
    const holdOpacity = this.inflight.opacity > 0 || this.pendingOpacity !== null;
    this.store.getState().showInfo({
      ...info,
      scale: holdScale && current ? current.scale : info.scale,
      opacity: holdOpacity && current ? current.opacity : info.opacity,
    });
  }

  private settle(field: 'scale' | 'opacity'): void {
    if (this.disposed || !this.latest) return;
    if (field === 'scale') {
      if (this.inflight.scale === 0 && this.pendingScale === null)
        this.store.getState().patchInfo({ scale: this.latest.scale });
    } else if (this.inflight.opacity === 0 && this.pendingOpacity === null) {
      this.store.getState().patchInfo({ opacity: this.latest.opacity });
    }
  }

  private schedule(): void {
    if (!this.cancelFrame) this.cancelFrame = this.frame(() => this.flush());
  }

  private flush(): void {
    this.cancelFrame = null;
    const { pendingScale, pendingOpacity, pendingMove } = this;
    this.pendingScale = null;
    this.pendingOpacity = null;
    this.pendingMove = null;
    if (pendingScale) {
      void this.fire({
        type: 'scale',
        value: pendingScale.value,
        ...(pendingScale.anchor ? { anchor: pendingScale.anchor } : {}),
      });
    }
    if (pendingOpacity !== null) void this.fire({ type: 'opacity', value: pendingOpacity });
    if (pendingMove) void this.fire({ type: 'move', x: pendingMove.x, y: pendingMove.y });
  }

  /** Sends one action; a failure is logged and never thrown (the page keeps working). */
  private async fire(action: PinAction): Promise<void> {
    const field =
      action.type === 'scale' || action.type === 'resetScale'
        ? 'scale'
        : action.type === 'opacity'
          ? 'opacity'
          : null;
    if (field) this.inflight[field] += 1;
    try {
      await this.bridge.invoke('pin:action', action);
    } catch (error) {
      await this.log('warn', `Pin action "${action.type}" failed: ${messageOf(error)}`);
      if (field) await this.resync();
    } finally {
      if (field) {
        this.inflight[field] -= 1;
        this.settle(field);
      }
    }
  }

  /** After a rejected request the page's optimistic value may be wrong: ask the truth. */
  private async resync(): Promise<void> {
    try {
      const info = await this.bridge.invoke('pin:getInfo');
      if (!this.disposed && info) this.latest = info;
    } catch {
      // The window is probably gone.
    }
  }

  private async run(button: PinButton, action: PinAction): Promise<void> {
    const state = this.store.getState();
    if (state.buttons[button] === 'busy') return;
    state.setButton(button, 'busy');
    try {
      await this.bridge.invoke('pin:action', action);
      this.flash(button, 'done');
    } catch (error) {
      this.flash(button, 'error');
      await this.log('warn', `Pin action "${action.type}" failed: ${messageOf(error)}`);
    }
  }

  private flash(button: PinButton, status: ButtonStatus): void {
    if (this.disposed) return;
    this.store.getState().setButton(button, status);
    window.clearTimeout(this.timers.get(button));
    this.timers.set(
      button,
      window.setTimeout(() => {
        this.timers.delete(button);
        this.store.getState().setButton(button, 'idle');
      }, this.feedbackMs),
    );
  }

  private async log(level: 'warn' | 'error', message: string): Promise<void> {
    await this.bridge
      .invoke('app:log', { level, scope: 'pin', message: message.slice(0, 3900) })
      .catch(() => undefined);
  }
}

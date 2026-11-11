import { Speaker } from '@renderer/assistant/voice/tts';
import { showToast } from '@renderer/components/Toast';
import type { Rect } from '@shared/geometry';
import type { Bridge } from '@shared/ipc/bridge';
import type { OcrResultDto, SmartActionDto } from '@shared/ipc/types';
import { IDLE_AI, IDLE_OCR, sceneOffsetFor, useCircleStore, type SelectionSource } from './store';

const SHEET_COLLAPSED_RATIO = 0.42;
const OCR_RESIZE_DELAY_MS = 220;
const DOUBLE_TAP_MS = 600;
const DOUBLE_TAP_DISTANCE_PX = 12;
const EXIT_FALLBACK_MS = 800;

type Store = typeof useCircleStore;

function newStreamId(): string {
  return `ask-${crypto.randomUUID()}`;
}

/**
 * Everything the Circle to Search overlay does besides drawing: it receives the frozen screen from
 * the main process, turns gestures into selections, asks main for OCR / actions and owns the exit
 * handshake (reverse animation first, then `circle:close`). Pure logic over a fake bridge/store in
 * unit tests.
 */
export class CircleController {
  private ocrRequest = 0;
  private ocrTimer: number | null = null;
  private exitTimer: number | null = null;
  private autoActionDone = false;
  private lastTap: { x: number; y: number; at: number } | null = null;
  private image: HTMLImageElement | null = null;

  constructor(
    private readonly bridge: Bridge<'circle'>,
    private readonly speaker: Speaker = new Speaker(),
    private readonly store: Store = useCircleStore,
  ) {}

  /** Subscribes to main-process events and loads initial data. Returns the cleanup function. */
  async start(): Promise<() => void> {
    const { bridge, store } = this;
    const offs = [
      bridge.on('circle:session', (session) => void this.onSession(session)),
      bridge.on('circle:cancel', () => this.beginExit()),
      bridge.on('circle:aiChunk', (event) => this.onAiChunk(event)),
      bridge.on('settings:changed', (settings) => store.getState().setSettings(settings)),
      bridge.on('theme:changed', ({ theme }) => {
        document.documentElement.dataset['theme'] = theme;
      }),
    ];
    const [settings, info, pending] = await Promise.all([
      bridge.invoke('settings:get'),
      bridge.invoke('app:info'),
      bridge.invoke('circle:getSession'),
    ]);
    store.getState().setSettings(settings);
    document.documentElement.dataset['theme'] = info.theme;
    if (pending && !store.getState().session) void this.onSession(pending);
    return () => {
      for (const off of offs) off();
      this.clearTimers();
      this.speaker.cancel();
    };
  }

  /** The decoded screenshot, for thumbnails. */
  get screenshot(): HTMLImageElement | null {
    return this.image;
  }

  // ---- session lifecycle ---------------------------------------------------------------------

  private async onSession(
    session: NonNullable<ReturnType<Store['getState']>['session']>,
  ): Promise<void> {
    this.clearTimers();
    this.speaker.cancel();
    this.ocrRequest += 1;
    this.autoActionDone = false;
    this.lastTap = null;
    const state = this.store.getState();
    state.reset();
    state.setSession(session);

    const image = new Image();
    image.src = session.imageUrl;
    try {
      await image.decode();
    } catch {
      await this.log('error', 'The screenshot could not be decoded');
      return;
    }
    this.image = image;
    this.store.getState().setVisible(true);
    await this.bridge.invoke('circle:ready', { sessionId: session.id });
  }

  /** Esc, right-click, backdrop actions and main-process cancellations all end up here. */
  beginExit(): void {
    const state = this.store.getState();
    if (!state.visible) {
      void this.acknowledgeClosed();
      return;
    }
    this.clearTimers();
    this.speaker.cancel();
    this.ocrRequest += 1;
    void this.bridge.invoke('circle:stopAi', {}).catch(() => undefined);
    state.setPhase('closing');
    state.setSheetOpen(false);
    state.setVisible(false);
    this.exitTimer = window.setTimeout(() => void this.acknowledgeClosed(), EXIT_FALLBACK_MS);
  }

  /** Called when the reverse animation finished: main hides the window and drops the capture. */
  async acknowledgeClosed(): Promise<void> {
    if (this.exitTimer !== null) {
      window.clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
    this.store.getState().reset();
    this.image = null;
    await this.bridge.invoke('circle:close').catch(() => undefined);
  }

  // ---- gestures -> selection -----------------------------------------------------------------

  beginGesture(): void {
    this.clearTimers();
    this.speaker.cancel();
    this.ocrRequest += 1;
    void this.bridge.invoke('circle:stopAi', {}).catch(() => undefined);
    const state = this.store.getState();
    state.setHintVisible(false);
    state.setSheetOpen(false);
    state.setSceneOffset(0);
    state.setSelection(null);
    state.setTapPoint(null);
    state.setOcr(IDLE_OCR);
    state.setAi(IDLE_AI);
    state.setPhase('drawing');
  }

  /** A stroke that did not select anything (too small): back to the idle state. */
  gestureIgnored(): void {
    this.store.getState().setPhase('idle');
  }

  selectRegion(rect: Rect, source: SelectionSource): void {
    const state = this.store.getState();
    state.setSelection(rect, source);
    state.setPhase('selected');
    state.setSheetOpen(true);
    this.updateSceneOffset();
    this.scheduleOcr(0);
  }

  /** A tap: read the line around the pointer and select the word under it (double tap: the line). */
  async tapAt(point: { x: number; y: number }): Promise<void> {
    const state = this.store.getState();
    const session = state.session;
    if (!session) return;
    const now = Date.now();
    const previous = this.lastTap;
    const whole =
      previous &&
      now - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.x, point.y - previous.y) < DOUBLE_TAP_DISTANCE_PX
        ? 'line'
        : 'word';
    this.lastTap = { ...point, at: now };

    const request = ++this.ocrRequest;
    state.setTapPoint(point);
    state.setPhase('drawing');
    try {
      const hit = await this.bridge.invoke('circle:tap', {
        sessionId: session.id,
        point: this.toDisplayPoint(point),
        whole,
      });
      if (request !== this.ocrRequest) return;
      const next = this.store.getState();
      next.setTapPoint(null);
      if (!hit) {
        next.setPhase('idle');
        showToast({
          title: 'No text there',
          message: 'Circle the area instead, or hold Shift and drag a rectangle.',
          tone: 'info',
        });
        return;
      }
      const rect = this.toViewportRect(hit.rect);
      next.setSelection(rect, 'tap');
      next.setPhase('selected');
      next.setSheetOpen(true);
      this.updateSceneOffset();
      this.finishOcr(hit.result);
    } catch (error) {
      if (request !== this.ocrRequest) return;
      const next = this.store.getState();
      next.setTapPoint(null);
      next.setPhase('idle');
      showToast({ title: 'Could not read the text', message: this.describe(error), tone: 'error' });
    }
  }

  hideHint(): void {
    this.store.getState().setHintVisible(false);
  }

  /** Dismisses the results (and the selection) but keeps the overlay open for a new selection. */
  closeSheet(): void {
    this.clearTimers();
    this.speaker.cancel();
    this.ocrRequest += 1;
    void this.bridge.invoke('circle:stopAi', {}).catch(() => undefined);
    const state = this.store.getState();
    state.setSheetOpen(false);
    state.setSceneOffset(0);
    state.setSelection(null);
    state.setOcr(IDLE_OCR);
    state.setAi(IDLE_AI);
    state.setSpeaking(false);
    state.setPhase('idle');
  }

  async openUrl(url: string): Promise<void> {
    await this.bridge.invoke('app:openExternal', { url }).catch(() => false);
  }

  /** The selection box was moved or resized by the user. */
  adjustSelection(rect: Rect, commit: boolean): void {
    const state = this.store.getState();
    state.setSelection(rect);
    if (!commit) return;
    this.speaker.cancel();
    state.setAi(IDLE_AI);
    this.updateSceneOffset();
    this.scheduleOcr(OCR_RESIZE_DELAY_MS);
  }

  private updateSceneOffset(): void {
    const state = this.store.getState();
    state.setSceneOffset(
      sceneOffsetFor(
        state.selection,
        window.innerHeight,
        Math.round(window.innerHeight * SHEET_COLLAPSED_RATIO),
      ),
    );
  }

  // ---- OCR ---------------------------------------------------------------------------------------

  private scheduleOcr(delayMs: number): void {
    if (this.ocrTimer !== null) window.clearTimeout(this.ocrTimer);
    this.store.getState().setOcr({ status: 'loading', result: null, text: '' });
    this.ocrTimer = window.setTimeout(() => {
      this.ocrTimer = null;
      void this.runOcr();
    }, delayMs);
  }

  /** Re-runs recognition for the current selection (retry button). */
  retryOcr(): void {
    this.scheduleOcr(0);
  }

  private async runOcr(): Promise<void> {
    const { session, selection } = this.store.getState();
    if (!session || !selection) return;
    const request = ++this.ocrRequest;
    try {
      const result = await this.bridge.invoke('circle:ocr', {
        sessionId: session.id,
        rect: this.toDisplayRect(selection),
      });
      if (request === this.ocrRequest) this.finishOcr(result);
    } catch (error) {
      if (request !== this.ocrRequest) return;
      this.store.getState().setOcr({
        status: 'error',
        result: null,
        text: '',
        message: this.describe(error),
      });
    }
  }

  private finishOcr(result: OcrResultDto): void {
    const text = result.text.trim();
    this.store.getState().setOcr({ status: 'done', result, text });
    if (this.autoActionDone || text === '') return;
    this.autoActionDone = true;
    const action = this.store.getState().session?.defaultAction ?? 'show';
    if (action === 'copy') void this.copyText();
    else if (action === 'search') void this.openText('search');
    else if (action === 'translate') void this.openText('translate');
  }

  // ---- results actions ---------------------------------------------------------------------------

  async copyText(): Promise<void> {
    const { text } = this.store.getState().ocr;
    if (text === '') return;
    await this.run('Could not copy the text', async () => {
      await this.bridge.invoke('app:copyText', { text });
      showToast({ title: 'Text copied', message: `${text.length} characters`, tone: 'success' });
    });
  }

  async openText(kind: 'search' | 'translate'): Promise<void> {
    const { text } = this.store.getState().ocr;
    if (text === '') return;
    await this.run('Could not open the browser', async () => {
      const opened = await this.bridge.invoke('circle:openText', { kind, text });
      if (opened) this.beginExit();
    });
  }

  async toggleSpeak(): Promise<void> {
    const state = this.store.getState();
    if (state.speaking) {
      this.speaker.cancel();
      state.setSpeaking(false);
      return;
    }
    if (state.ocr.text === '') return;
    const voice = state.settings?.voice;
    await this.speaker.speak(state.ocr.text, {
      voiceUri: voice?.ttsVoiceUri ?? '',
      rate: voice?.ttsRate ?? 1,
      onStart: () => this.store.getState().setSpeaking(true),
      onBoundary: () => undefined,
      onEnd: () => this.store.getState().setSpeaking(false),
    });
  }

  async runSmartAction(action: SmartActionDto): Promise<void> {
    await this.run('That action did not work', async () => {
      const result = await this.bridge.invoke('circle:smartAction', {
        type: action.type,
        value: action.value,
      });
      showToast({
        title: result.ok ? action.label : 'That did not work',
        ...(result.message ? { message: result.message } : {}),
        tone: result.ok ? 'success' : 'error',
      });
      if (result.ok && (action.type === 'url' || action.type === 'email')) this.beginExit();
    });
  }

  async copyImage(): Promise<void> {
    await this.withSelection('Could not copy the image', async (sessionId, rect) => {
      await this.bridge.invoke('circle:copyImage', { sessionId, rect });
      showToast({ title: 'Image copied', tone: 'success' });
    });
  }

  async saveImage(): Promise<void> {
    await this.withSelection('Could not save the image', async (sessionId, rect) => {
      const saved = await this.bridge.invoke('circle:saveImage', { sessionId, rect });
      if (saved) {
        const name = saved.path.split(/[\\/]/).pop() ?? saved.path;
        showToast({
          title: 'Image saved',
          message: `Pictures\\Beekeeper\\${name}`,
          tone: 'success',
        });
      }
    });
  }

  async searchImage(): Promise<void> {
    await this.withSelection('Could not start the image search', async (sessionId, rect) => {
      const opened = await this.bridge.invoke('circle:searchImage', { sessionId, rect });
      showToast({
        title: opened ? 'Image copied' : 'Image copied, but the browser did not open',
        message: 'Paste it (Ctrl+V) into Bing Visual Search.',
        tone: opened ? 'success' : 'warning',
      });
    });
  }

  async askAi(question: string): Promise<void> {
    await this.withSelection('Could not ask Azure OpenAI', async (sessionId, rect) => {
      const streamId = newStreamId();
      this.store
        .getState()
        .setAi({ status: 'streaming', text: '', streamId, question, message: '' });
      await this.bridge.invoke('circle:askAi', {
        sessionId,
        rect,
        streamId,
        ...(question.trim() ? { question: question.trim() } : {}),
      });
    });
  }

  stopAi(): void {
    void this.bridge.invoke('circle:stopAi', {}).catch(() => undefined);
    const { ai } = this.store.getState();
    if (ai.status === 'streaming') this.store.getState().setAi({ status: 'done' });
  }

  private onAiChunk(event: {
    streamId: string;
    delta?: string;
    done?: boolean;
    error?: string;
  }): void {
    const { ai, setAi } = this.store.getState();
    if (event.streamId !== ai.streamId) return;
    if (event.error) setAi({ status: 'error', message: event.error });
    else if (event.done) setAi({ status: 'done' });
    else if (event.delta) setAi({ text: ai.text + event.delta });
  }

  // ---- helpers -----------------------------------------------------------------------------------

  private async withSelection(
    failure: string,
    action: (sessionId: string, rect: Rect) => Promise<void>,
  ): Promise<void> {
    const { session, selection } = this.store.getState();
    if (!session || !selection) return;
    await this.run(failure, () => action(session.id, this.toDisplayRect(selection)));
  }

  private async run(failure: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      showToast({ title: failure, message: this.describe(error), tone: 'error' });
    }
  }

  private describe(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    return /not active/i.test(message)
      ? 'This capture has expired. Start Circle to Search again.'
      : 'Please try again.';
  }

  private ratio(): { x: number; y: number } {
    const bounds = this.store.getState().session?.display.bounds;
    return {
      x: bounds && window.innerWidth > 0 ? bounds.width / window.innerWidth : 1,
      y: bounds && window.innerHeight > 0 ? bounds.height / window.innerHeight : 1,
    };
  }

  /** Viewport CSS pixels -> display DIPs (identical unless the window ended up a different size). */
  private toDisplayRect(rect: Rect): Rect {
    const { x, y } = this.ratio();
    return { x: rect.x * x, y: rect.y * y, width: rect.width * x, height: rect.height * y };
  }

  private toDisplayPoint(point: { x: number; y: number }): { x: number; y: number } {
    const { x, y } = this.ratio();
    return { x: point.x * x, y: point.y * y };
  }

  private toViewportRect(rect: Rect): Rect {
    const { x, y } = this.ratio();
    return { x: rect.x / x, y: rect.y / y, width: rect.width / x, height: rect.height / y };
  }

  private clearTimers(): void {
    if (this.ocrTimer !== null) window.clearTimeout(this.ocrTimer);
    if (this.exitTimer !== null) window.clearTimeout(this.exitTimer);
    this.ocrTimer = null;
    this.exitTimer = null;
  }

  private async log(level: 'error' | 'warn', message: string): Promise<void> {
    await this.bridge.invoke('app:log', { level, scope: 'circle', message }).catch(() => undefined);
  }
}

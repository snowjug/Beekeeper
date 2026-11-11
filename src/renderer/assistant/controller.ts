import type { Bridge } from '@shared/ipc/bridge';
import type {
  AssistantShowEvent,
  CardUpdateEvent,
  StreamEvent,
  TimerFiredEvent,
} from '@shared/ipc/types';
import type { Card, CardAction, StatusCard, TimerCard } from '@shared/cards';
import { showToast } from '@renderer/components/Toast';
import { describeCard, useAssistantStore } from './store';

export type EarconKind = 'start' | 'stop' | 'error' | 'chime';

/** Voice side of the assistant (microphone, speech recognition, TTS, earcons). */
export interface VoiceHooks {
  speak(text: string): void;
  stopSpeaking(): void;
  startListening(source: AssistantShowEvent['source']): Promise<void>;
  /** `submit` sends the recognised text as a command, otherwise it is discarded. */
  stopListening(submit: boolean): void;
  playEarcon(kind: EarconKind): void;
}

const AUTO_CLOSE_SETTLE_MS = 250;
let cardCounter = 0;

function localId(prefix: string): string {
  cardCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${cardCounter}`;
}

export function statusCard(
  tone: StatusCard['tone'],
  icon: StatusCard['icon'],
  title: string,
  detail?: string,
): StatusCard {
  return {
    kind: 'status',
    id: localId('status'),
    createdAt: Date.now(),
    tone,
    icon,
    title,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Glue between the main process (commands, timers, settings) and the assistant UI state.
 * Everything the user can do in the bar goes through this class so it can be unit tested with a
 * fake bridge and fake voice hooks.
 */
export class AssistantController {
  private autoCloseTimer: number | null = null;
  private recallOffset = -1;
  private recallDraft = '';
  private voice: VoiceHooks;

  constructor(
    private readonly bridge: Bridge<'assistant'>,
    voice: VoiceHooks,
    private readonly store = useAssistantStore,
  ) {
    this.voice = voice;
  }

  /** Subscribes to main-process events and loads initial data. Returns the cleanup function. */
  async start(): Promise<() => void> {
    const bridge = this.bridge;
    const offs = [
      bridge.on('assistant:show', (event) => void this.onShow(event)),
      bridge.on('assistant:hide', () => this.onHide()),
      bridge.on(
        'assistant:startListening',
        (event) => void this.voice.startListening(event.source),
      ),
      bridge.on('assistant:stopListening', (event) => this.voice.stopListening(event.submit)),
      bridge.on('assistant:stopSpeaking', () => this.voice.stopSpeaking()),
      bridge.on('assistant:stream', (event) => this.onStream(event)),
      bridge.on('assistant:timerFired', (event) => this.onTimerFired(event)),
      bridge.on('assistant:cardUpdate', (event) => this.onCardUpdate(event)),
      bridge.on('settings:changed', (settings) => this.store.getState().setSettings(settings)),
      bridge.on('theme:changed', ({ theme }) => this.applyTheme(theme)),
      bridge.on('toast:show', (toast) =>
        showToast({
          title: toast.title,
          tone: toast.tone,
          durationMs: toast.action ? 0 : 5000,
          ...(toast.message ? { message: toast.message } : {}),
          ...(toast.action
            ? {
                action: {
                  label: toast.action.label,
                  onClick: () => {
                    if (toast.action?.id === 'install-update') {
                      void this.bridge.invoke('updates:install').catch(() => undefined);
                    } else {
                      this.openSettings();
                    }
                  },
                },
              }
            : {}),
        }),
      ),
    ];

    const [settings, info] = await Promise.all([
      bridge.invoke('settings:get'),
      bridge.invoke('app:info'),
    ]);
    this.store.getState().setSettings(settings);
    this.applyTheme(info.theme);
    return () => {
      for (const off of offs) off();
      this.clearAutoClose();
    };
  }

  applyTheme(theme: 'light' | 'dark'): void {
    document.documentElement.dataset['theme'] = theme;
    this.store.getState().setTheme(theme);
  }

  // ---- visibility ---------------------------------------------------------------------------

  private async onShow(event: AssistantShowEvent): Promise<void> {
    this.clearAutoClose();
    const state = this.store.getState();
    state.reset();
    state.noteShown(event);
    this.recallOffset = -1;

    if (event.view === 'history') {
      await this.openHistory();
    } else if (event.view === 'notes') {
      await this.submit('show my notes', 'chip');
    } else if (event.view === 'timers') {
      await this.submit('show my timers', 'chip');
    } else if (event.view === 'gallery') {
      await this.submit('what can you do', 'chip');
    }
    if (event.listen) await this.voice.startListening(event.source);
  }

  private onHide(): void {
    this.clearAutoClose();
    this.voice.stopListening(false);
    this.voice.stopSpeaking();
    this.store.getState().setVisible(false);
  }

  /** The renderer asks main to hide the bar (Esc, backdrop click, "close" commands). */
  async close(reason: 'escape' | 'backdrop' | 'auto' | 'command'): Promise<void> {
    this.clearAutoClose();
    this.voice.stopSpeaking();
    this.voice.stopListening(false);
    await this.bridge.invoke('assistant:close', { reason });
  }

  /** Called when the exit animation is finished so main can really hide the window. */
  async acknowledgeHidden(): Promise<void> {
    // The bar may have been shown again before a slow exit animation finished: keep it.
    if (this.store.getState().visible) return;
    this.store.getState().reset();
    await this.bridge.invoke('assistant:hidden');
  }

  // ---- submitting ---------------------------------------------------------------------------

  async submitInput(): Promise<void> {
    const text = this.store.getState().input;
    await this.submit(text, 'text');
  }

  async submit(text: string, source: 'text' | 'voice' | 'chip' | 'circle'): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.clearAutoClose();
    this.recallOffset = -1;
    const state = this.store.getState();
    state.setInput('');
    state.setNotice(null);
    state.setPending(true);
    state.setOrb('thinking');
    this.voice.stopSpeaking();

    try {
      const result = await this.bridge.invoke('assistant:submit', { text: trimmed, source });
      const next = this.store.getState();
      next.setPending(false);
      next.setTranscript({ partial: '' });
      next.addCards(result.cards);
      if (result.pin) await this.setPinned(true);

      const wantsSpeech = next.settings?.voice.ttsEnabled ?? true;
      if (result.speech && wantsSpeech) {
        this.voice.speak(result.speech);
      } else {
        next.setOrb('idle');
      }
      if (result.closeNow) {
        await this.close('command');
      } else if (result.autoCloseMs && !result.pin) {
        this.scheduleAutoClose(result.autoCloseMs);
      }
    } catch (error) {
      const failed = this.store.getState();
      failed.setPending(false);
      failed.setOrb('error');
      failed.addCards([
        statusCard(
          'error',
          'error',
          'Something went wrong',
          error instanceof Error ? error.message : undefined,
        ),
      ]);
      this.voice.playEarcon('error');
      window.setTimeout(() => this.store.getState().setOrb('idle'), 900);
    }
  }

  // ---- cards --------------------------------------------------------------------------------

  async confirm(confirmId: string): Promise<void> {
    const matches = (card: Card): boolean => 'confirmId' in card && card.confirmId === confirmId;
    try {
      const outcome = await this.bridge.invoke('assistant:confirm', { confirmId });
      const state = this.store.getState();
      switch (outcome.status) {
        case 'countdown':
          state.replaceCard(matches, outcome.card);
          break;
        case 'executed':
          state.replaceCard(matches, statusCard('success', 'check', 'Done'));
          break;
        case 'failed':
          state.replaceCard(
            matches,
            statusCard('error', 'error', 'That did not work', outcome.message),
          );
          break;
        case 'unknown':
          state.replaceCard(
            matches,
            statusCard(
              'warning',
              'info',
              'That request expired',
              'Ask me again if you still want it.',
            ),
          );
          break;
      }
    } catch (error) {
      this.store
        .getState()
        .replaceCard(
          matches,
          statusCard(
            'error',
            'error',
            'That did not work',
            error instanceof Error ? error.message : undefined,
          ),
        );
    }
  }

  async cancelConfirm(confirmId: string): Promise<void> {
    const matches = (card: Card): boolean => 'confirmId' in card && card.confirmId === confirmId;
    await this.bridge.invoke('assistant:cancelPending', { confirmId }).catch(() => undefined);
    this.store.getState().replaceCard(matches, statusCard('neutral', 'stop', 'Cancelled'));
  }

  async cancelTimer(card: TimerCard): Promise<void> {
    await this.bridge.invoke('assistant:cancelTimer', { id: card.timerId }).catch(() => undefined);
    this.store
      .getState()
      .replaceCard((candidate) => candidate.id === card.id, { ...card, state: 'cancelled' });
  }

  async runAction(action: CardAction): Promise<void> {
    if (action.type === 'command') {
      await this.submit(action.text, 'chip');
      return;
    }
    const ok = await this.bridge.invoke('assistant:cardAction', { action }).catch(() => false);
    if (!ok) showToast({ title: "I couldn't open that", tone: 'warning' });
  }

  async copyCard(card: Card): Promise<void> {
    await this.copyText(describeCard(card));
  }

  async copyText(text: string): Promise<void> {
    await this.bridge.invoke('app:copyText', { text });
    showToast({ title: 'Copied to clipboard', tone: 'success', durationMs: 1800 });
  }

  async openUrl(url: string): Promise<void> {
    const ok = await this.bridge.invoke('app:openExternal', { url }).catch(() => false);
    if (!ok) showToast({ title: "I couldn't open that link", tone: 'warning' });
  }

  async stopStream(cardId: string): Promise<void> {
    await this.bridge.invoke('assistant:stopStream', { cardId });
    this.store.getState().finishAnswer(cardId);
  }

  async setPinned(pinned: boolean): Promise<void> {
    this.store.getState().setPinned(pinned);
    await this.bridge.invoke('assistant:setPinned', { pinned });
  }

  async togglePinned(): Promise<void> {
    await this.setPinned(!this.store.getState().pinned);
  }

  openSettings(
    section?: 'general' | 'voice' | 'hotkeys' | 'circle' | 'ai' | 'privacy' | 'updates' | 'about',
  ): void {
    void this.bridge.invoke('window:openSettings', section ? { section } : {});
  }

  // ---- history ------------------------------------------------------------------------------

  async openHistory(): Promise<void> {
    await this.loadHistory('');
    this.store.getState().setView('history');
  }

  async loadHistory(query: string): Promise<void> {
    const state = this.store.getState();
    state.setHistoryQuery(query);
    const list = await this.bridge.invoke(
      'assistant:history',
      query ? { query, limit: 100 } : { limit: 100 },
    );
    this.store.getState().setHistory(list.entries);
  }

  async clearHistory(): Promise<void> {
    await this.bridge.invoke('assistant:clearHistory');
    this.store.getState().setHistory([]);
    showToast({ title: 'History cleared', tone: 'success', durationMs: 1800 });
  }

  closeHistory(): void {
    this.store.getState().setView('home');
  }

  /** Up-arrow recall of earlier inputs (Down walks back to the draft). */
  async recallPrevious(): Promise<void> {
    const state = this.store.getState();
    if (this.recallOffset === -1) this.recallDraft = state.input;
    const text = await this.bridge.invoke('assistant:recall', { offset: this.recallOffset + 1 });
    if (text === null) return;
    this.recallOffset += 1;
    this.store.getState().setInput(text);
  }

  async recallNext(): Promise<void> {
    if (this.recallOffset < 0) return;
    this.recallOffset -= 1;
    if (this.recallOffset < 0) {
      this.store.getState().setInput(this.recallDraft);
      return;
    }
    const text = await this.bridge.invoke('assistant:recall', { offset: this.recallOffset });
    this.store.getState().setInput(text ?? this.recallDraft);
  }

  // ---- main-process events ------------------------------------------------------------------

  private onStream(event: StreamEvent): void {
    const state = this.store.getState();
    if (event.delta) state.appendAnswer(event.cardId, event.delta);
    if (event.done || event.error) {
      state.finishAnswer(event.cardId, event.error);
      if (event.error) this.voice.playEarcon('error');
    }
  }

  private onTimerFired({ timer, missed }: TimerFiredEvent): void {
    const card: TimerCard = {
      kind: 'timer',
      id: localId('timer'),
      createdAt: Date.now(),
      timerId: timer.id,
      timerType: timer.type,
      label: missed ? `${timer.label} (missed)` : timer.label,
      durationMs: timer.durationMs,
      startedAt: timer.startedAt,
      endsAt: timer.endsAt,
      state: 'done',
    };
    const state = this.store.getState();
    state.replaceCard(
      (existing) => existing.kind === 'timer' && existing.timerId === timer.id,
      null,
    );
    state.addCards([card]);
    void this.setPinned(true);
    this.voice.playEarcon('chime');
  }

  private onCardUpdate(event: CardUpdateEvent): void {
    this.store
      .getState()
      .replaceCard(
        (card) => 'confirmId' in card && card.confirmId === event.confirmId,
        event.replacement,
      );
  }

  // ---- auto close ---------------------------------------------------------------------------

  private scheduleAutoClose(delayMs: number): void {
    this.clearAutoClose();
    const attempt = (): void => {
      const state = this.store.getState();
      // Never close while the user is talking, listening or the bar is pinned.
      if (state.pinned || state.listening || state.pending) return;
      if (state.speaking || state.input.length > 0) {
        this.autoCloseTimer = window.setTimeout(attempt, AUTO_CLOSE_SETTLE_MS * 4);
        return;
      }
      void this.close('auto');
    };
    this.autoCloseTimer = window.setTimeout(attempt, delayMs);
  }

  private clearAutoClose(): void {
    if (this.autoCloseTimer !== null) {
      window.clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }
}

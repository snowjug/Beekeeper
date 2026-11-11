import type {
  DictationAbortReason,
  DictationSubmitResult,
  TranscribeResult,
} from '@shared/ipc/types';
import type { Settings } from '@shared/settings';
import type { WindowRef } from '../system/foreground';
import { analyzeAudio } from './audio';
import { abortMessage, MESSAGES, transcribeErrorMessage } from './messages';
import { postProcess } from './postProcess';
import type {
  DictationControllerDeps,
  DictationFeature,
  DictationSource,
  DictationState,
  DictationTimings,
  Win32Services,
} from './types';

export const DEFAULT_TIMINGS: DictationTimings = {
  maxSeconds: 60,
  startMs: 20_000,
  listenMs: 75_000,
  transcribeMs: 90_000,
  typeMs: 30_000,
  stopMs: 6000,
  settleMs: 1000,
  doneMs: 1200,
  messageMs: 2600,
  cancelMs: 250,
  continueMs: 30_000,
};

const SETTLE_POLL_MS = 40;

type CancelReason = 'escape' | 'pill' | 'toggle';

interface Session {
  readonly source: DictationSource;
  target: WindowRef | null;
  /** The session is over (finished, cancelled or failed): late results are ignored. */
  ended: boolean;
  stopRequested: boolean;
  pillShown: boolean;
  micOn: boolean;
  wakePaused: boolean;
  watchdog: NodeJS.Timeout | null;
  stopTimer: NodeJS.Timeout | null;
  hideTimer: NodeJS.Timeout | null;
}

interface Delivery {
  delivered: boolean;
  /** What did not reach the app (everything when nothing was typed). */
  rest: string;
}

/** Language Whisper is asked for: "inherit" follows the voice setting. */
export function resolveLanguage(settings: Settings): 'auto' | 'en' | 'hi' {
  const { language } = settings.dictation;
  return language === 'inherit' ? settings.voice.language : language;
}

/**
 * The life of one dictation: hotkey -> pill + microphone -> speech to text -> typed into the app
 * that had the focus. Every dependency is injected so the whole state machine runs in unit tests.
 * Whatever goes wrong, the pill is hidden, the microphone released, the wake word resumed and the
 * Esc key given back (phase timers watch for a stuck session).
 */
export class DictationController implements DictationFeature {
  private state: DictationState = 'idle';
  private session: Session | null = null;
  private disposed = false;
  private last: { handle: number; at: number; endsWithBreak: boolean } | null = null;
  private readonly timings: DictationTimings;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: DictationControllerDeps) {
    this.timings = { ...DEFAULT_TIMINGS, ...deps.timings };
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get phase(): DictationState {
    return this.state;
  }

  get active(): boolean {
    return this.state !== 'idle' && this.state !== 'finishing';
  }

  toggle(source: DictationSource): void {
    if (this.disposed) return;
    switch (this.state) {
      case 'idle':
      case 'finishing':
        this.begin(source).catch((error: unknown) => {
          this.deps.logger.error('Dictation failed to start', error);
        });
        return;
      case 'listening':
        this.requestStop();
        return;
      case 'starting':
      case 'transcribing':
        this.cancel('toggle');
        return;
      case 'typing':
        return;
    }
  }

  /** The pill hands over what it recorded (`dictation:submit`). */
  async submit(samples: Float32Array): Promise<DictationSubmitResult> {
    const session = this.session;
    if (!session || session.ended || this.state !== 'listening') {
      return { ok: false, message: 'Dictation is not active.' };
    }
    this.clearTimer(session, 'stopTimer');
    this.state = 'transcribing';
    this.arm(session, this.timings.transcribeMs);
    this.releaseMic(session);
    this.deps.pill.status({ phase: 'transcribing' });

    const settings = this.deps.settings();
    const facts = analyzeAudio(samples);
    let heard: TranscribeResult;
    try {
      heard = await this.deps.speech.transcribe({ samples, language: resolveLanguage(settings) });
    } catch (error) {
      if (this.stale(session)) return { ok: false, message: 'Cancelled.' };
      this.deps.logger.warn('Dictation: speech recognition failed', error);
      const message = transcribeErrorMessage(error);
      await this.fail(session, message);
      return { ok: false, message };
    }
    if (this.stale(session)) return { ok: false, message: 'Cancelled.' };

    const text = postProcess(heard.text, {
      spokenPunctuation: settings.dictation.spokenPunctuation,
      audio: facts,
    });
    this.deps.logger.info(
      `Dictation: ${facts.durationMs} ms of audio, ${heard.text.length} characters heard in ` +
        `${heard.durationMs} ms (${heard.lang}, ${heard.model}), ${text.length} to type`,
    );
    if (text === '') {
      await this.fail(session, MESSAGES.nothingHeard);
      return { ok: false, message: MESSAGES.nothingHeard };
    }
    return this.deliver(session, text, settings);
  }

  /** The pill gave up before it had audio (`dictation:abort`). */
  abort(reason: DictationAbortReason, detail?: string): void {
    const session = this.session;
    if (!session || session.ended) return;
    if (this.state !== 'listening' && this.state !== 'starting') return;
    this.deps.logger.info(`Dictation: the pill gave up (${reason})${detail ? `: ${detail}` : ''}`);
    this.failQuietly(session, abortMessage(reason));
  }

  /** Esc, the pill's close button or a second hotkey press while transcribing. */
  cancel(reason: CancelReason): void {
    const session = this.session;
    if (!session || session.ended) return;
    if (this.state === 'typing' || this.state === 'idle' || this.state === 'finishing') return;
    this.deps.logger.info(`Dictation cancelled (${reason})`);
    this.end(session);
    this.deps.pill.stop(false);
    this.deps.pill.status({ phase: 'cancelled' });
    this.scheduleHide(session, this.timings.cancelMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const session = this.session;
    if (session) {
      this.end(session);
      this.clearTimer(session, 'hideTimer');
    }
    this.session = null;
    this.state = 'idle';
    this.deps.pill.destroy();
  }

  // ---- start ------------------------------------------------------------------------------

  private async begin(source: DictationSource): Promise<void> {
    const previous = this.session;
    if (previous) {
      this.end(previous);
      this.clearTimer(previous, 'hideTimer');
    }
    const session: Session = {
      source,
      target: null,
      ended: false,
      stopRequested: false,
      pillShown: false,
      micOn: false,
      wakePaused: false,
      watchdog: null,
      stopTimer: null,
      hideTimer: null,
    };
    this.session = session;
    this.state = 'starting';
    this.arm(session, this.timings.startMs);

    try {
      const settings = this.deps.settings();
      if (!settings.dictation.enabled) {
        await this.fail(session, MESSAGES.disabled);
        return;
      }

      const services = await this.deps.services();
      if (this.stale(session)) return;
      if (services) {
        const target = await this.findTarget(session, services);
        if (this.stale(session)) return;
        if (!target) {
          await this.fail(session, MESSAGES.noTarget);
          return;
        }
        session.target = target;
      }

      this.deps.stopAssistantListening();
      this.deps.setWakePaused(true);
      session.wakePaused = true;
      await this.deps.pill.show(session.target);
      session.pillShown = true;
      if (this.stale(session)) return;

      this.deps.setMicActive(true);
      session.micOn = true;
      this.deps.escape.arm(() => this.cancel('escape'));
      this.state = 'listening';
      this.arm(session, this.timings.listenMs);
      this.deps.pill.start({
        language: resolveLanguage(settings),
        micDeviceId: settings.voice.micDeviceId,
        silenceMs: Math.round(settings.dictation.silenceSeconds * 1000),
        maxSeconds: this.timings.maxSeconds,
        earcons: settings.voice.earcons,
        theme: this.deps.theme(),
        hotkey: this.deps.hotkey(),
      });
      this.deps.logger.info(
        `Dictation started (${source}, ${resolveLanguage(settings)}, ${settings.dictation.method})`,
      );
    } catch (error) {
      if (this.stale(session)) return;
      this.deps.logger.warn('Dictation could not start', error);
      await this.fail(session, MESSAGES.unresponsive);
    }
  }

  /** The window to type into: the one with the focus, once Beekeeper's own windows stepped aside. */
  private async findTarget(session: Session, services: Win32Services): Promise<WindowRef | null> {
    const usable = (window: WindowRef | null): window is WindowRef =>
      window !== null &&
      !this.deps.isOwnWindow(window.handle) &&
      // The tray menu belongs to Beekeeper's process but is not one of its windows.
      !(session.source === 'tray' && window.pid === this.deps.ownPid);

    const first = services.foreground.current();
    if (usable(first)) return first;

    this.deps.releaseOwnFocus();
    for (let waited = 0; waited < this.timings.settleMs; waited += SETTLE_POLL_MS) {
      await this.sleep(SETTLE_POLL_MS);
      if (this.stale(session)) return null;
      const current = services.foreground.current();
      if (usable(current)) return current;
    }
    return null;
  }

  private requestStop(): void {
    const session = this.session;
    if (!session || session.ended || session.stopRequested) return;
    session.stopRequested = true;
    this.deps.pill.stop(true);
    // The pill normally answers within a few hundred milliseconds.
    session.stopTimer = setTimeout(() => {
      session.stopTimer = null;
      if (this.state === 'listening' && !session.ended) {
        this.deps.logger.warn('Dictation: the pill did not hand over its recording');
        this.failQuietly(session, MESSAGES.unresponsive);
      }
    }, this.timings.stopMs);
  }

  // ---- result -----------------------------------------------------------------------------

  private async deliver(
    session: Session,
    text: string,
    settings: Settings,
  ): Promise<DictationSubmitResult> {
    this.state = 'typing';
    this.arm(session, this.timings.typeMs);
    this.deps.pill.status({ phase: 'typing', text });

    const started = this.now();
    const delivery = await this.inject(session, text, settings);
    if (this.stale(session)) return { ok: false, message: 'Cancelled.' };

    if (delivery.delivered) {
      this.end(session);
      this.deps.logger.info(
        `Dictation: typed ${text.length} characters (${settings.dictation.method}) in ${this.now() - started} ms`,
      );
      this.deps.pill.status({ phase: 'done', text });
      this.scheduleHide(session, this.timings.doneMs);
      return { ok: true, text };
    }

    try {
      await this.deps.clipboard.writeText(delivery.rest);
    } catch (error) {
      // Neither typed nor copied: the text is lost, and the pill must not claim otherwise.
      this.deps.logger.warn('Dictation: the clipboard could not be written', error);
      if (this.stale(session)) return { ok: false, message: MESSAGES.lost };
      this.end(session);
      this.deps.pill.status({ phase: 'error', message: MESSAGES.lost });
      this.scheduleHide(session, this.timings.messageMs);
      return { ok: false, message: MESSAGES.lost };
    }
    if (this.stale(session)) return { ok: true, text, message: MESSAGES.copied };
    this.end(session);
    this.deps.pill.status({ phase: 'done', text, message: MESSAGES.copied });
    this.scheduleHide(session, this.timings.messageMs);
    return { ok: true, text, message: MESSAGES.copied };
  }

  /** Types (or pastes) into the window that had the focus; never anywhere else. */
  private async inject(session: Session, text: string, settings: Settings): Promise<Delivery> {
    const undelivered = (reason: string, rest = text): Delivery => {
      this.deps.logger.info(`Dictation: not typed (${reason}), the text goes to the clipboard`);
      return { delivered: false, rest };
    };

    const services = await this.deps.services();
    const target = session.target;
    if (!services || !target) return undelivered('typing is not available');
    if (this.stale(session)) return undelivered('cancelled');

    const { foreground, injector } = services;
    const current = foreground.current();
    if (!current || current.handle !== target.handle) return undelivered('the focus moved');
    if (this.deps.isOwnWindow(current.handle)) return undelivered('Beekeeper window');
    if (foreground.blocksInput(current)) return undelivered('the app runs elevated');

    const payload = `${this.continuation(target, text)}${text}`;
    const outcome =
      settings.dictation.method === 'paste'
        ? await injector.pasteText(payload)
        : await injector.typeText(payload, {
            shouldContinue: () => foreground.current()?.handle === target.handle,
          });
    if (outcome.status === 'ok') {
      this.last = {
        handle: target.handle,
        at: this.now(),
        endsWithBreak: /\s$/u.test(payload),
      };
      return { delivered: true, rest: '' };
    }
    return undelivered(outcome.reason, outcome.typed === 0 ? text : payload.slice(outcome.typed));
  }

  /** A space when this dictation continues a sentence the last one typed into the same window. */
  private continuation(target: WindowRef, text: string): string {
    const last = this.last;
    if (!last || last.handle !== target.handle || last.endsWithBreak) return '';
    if (this.now() - last.at > this.timings.continueMs) return '';
    return /^[\p{L}\p{N}"'([]/u.test(text) ? ' ' : '';
  }

  // ---- ending -----------------------------------------------------------------------------

  private failQuietly(session: Session, message: string): void {
    this.fail(session, message).catch((error: unknown) => {
      this.deps.logger.error('Dictation could not report a problem', error);
    });
  }

  /** Shows `message` on the pill and ends the session. */
  private async fail(session: Session, message: string): Promise<void> {
    if (this.stale(session)) return;
    this.end(session);
    try {
      if (!session.pillShown) {
        await this.deps.pill.show(session.target);
        session.pillShown = true;
      }
    } catch (error) {
      this.deps.logger.warn('Dictation: the pill could not be shown', error);
      this.deps.pill.destroy();
      this.clearTimer(session, 'hideTimer');
      if (this.session === session) this.finish();
      return;
    }
    if (this.session !== session || this.disposed) return;
    this.deps.pill.stop(false);
    this.deps.pill.status({ phase: 'error', message });
    this.scheduleHide(session, this.timings.messageMs);
  }

  /** Marks the session over and gives back everything it held. */
  private end(session: Session): void {
    session.ended = true;
    this.clearTimer(session, 'watchdog');
    this.clearTimer(session, 'stopTimer');
    this.releaseMic(session);
    this.deps.escape.disarm();
    if (session.wakePaused) {
      session.wakePaused = false;
      this.deps.setWakePaused(false);
    }
    if (this.session === session) this.state = 'finishing';
  }

  private releaseMic(session: Session): void {
    if (!session.micOn) return;
    session.micOn = false;
    this.deps.setMicActive(false);
  }

  private scheduleHide(session: Session, ms: number): void {
    this.clearTimer(session, 'hideTimer');
    session.hideTimer = setTimeout(() => {
      session.hideTimer = null;
      if (this.session !== session) return;
      this.deps.pill.hide();
      this.finish();
    }, ms);
  }

  private finish(): void {
    this.session = null;
    this.state = 'idle';
  }

  // ---- safety -----------------------------------------------------------------------------

  /** (Re)starts the watchdog of the current phase. */
  private arm(session: Session, ms: number): void {
    this.clearTimer(session, 'watchdog');
    session.watchdog = setTimeout(() => {
      session.watchdog = null;
      if (session.ended || this.session !== session) return;
      this.deps.logger.warn(`Dictation was stuck in "${this.state}" and was reset`);
      this.end(session);
      this.clearTimer(session, 'hideTimer');
      // Closing the window is the sure way to release the microphone.
      this.deps.pill.destroy();
      this.finish();
    }, ms);
  }

  private stale(session: Session): boolean {
    return this.disposed || session.ended || this.session !== session;
  }

  private clearTimer(session: Session, name: 'watchdog' | 'stopTimer' | 'hideTimer'): void {
    const timer = session[name];
    if (timer) clearTimeout(timer);
    session[name] = null;
  }
}

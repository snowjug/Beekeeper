import type { MutableRefObject } from 'react';
import type { Bridge } from '@shared/ipc/bridge';
import type { DictationAbortReason, DictationStart, DictationStatus } from '@shared/ipc/types';
import { earconLength, Earcons, type EarconKind } from '@renderer/assistant/voice/earcons';
import { MicError, openMic as openRealMic, type MicSession } from '@renderer/lib/voice/mic';
import { smoothTowards } from '@renderer/motion/math';
import { Recording } from './recorder';
import { usePillStore } from './store';

/** The microphone keeps recording this long after "finish", so the last word is not cut off. */
export const TAIL_GRACE_MS = 180;
/** How long the result stays before the exit animation (the window hides a moment after). */
export const DONE_VISIBLE_MS = 900;
export const MESSAGE_VISIBLE_MS = 2300;

export interface EarconPlayer {
  play: (kind: EarconKind) => void;
  dispose: () => void;
}

export interface PillControllerDeps {
  bridge: Bridge<'dictation'>;
  store?: typeof usePillStore;
  openMic?: (deviceId: string) => Promise<MicSession>;
  earcons?: EarconPlayer;
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset['theme'] = theme;
}

function systemTheme(): 'light' | 'dark' {
  if (typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function abortReasonFor(error: unknown): DictationAbortReason {
  if (!(error instanceof MicError)) return 'error';
  switch (error.kind) {
    case 'denied':
      return 'mic-denied';
    case 'no-device':
      return 'mic-missing';
    case 'busy':
      return 'mic-busy';
    case 'unknown':
      return 'error';
  }
}

/**
 * The pill's brain: it records when the main process says `dictation:start`, decides with the
 * voice activity detector when the speaker is done (or when the user presses finish), hands the
 * audio to the main process and shows what the main process reports. The microphone is released
 * the moment recording ends, however it ends.
 */
export class DictationPillController {
  /** Smoothed microphone level 0..1 for the waveform and the orb. */
  readonly levelRef: MutableRefObject<number> = { current: 0 };

  private readonly store: typeof usePillStore;
  private readonly openMic: (deviceId: string) => Promise<MicSession>;
  private readonly earcons: EarconPlayer;
  private mic: MicSession | null = null;
  private recording: Recording | null = null;
  private earconsOn = true;
  private finishing = false;
  /** The microphone is being opened (the page already shows the pill). */
  private opening = false;
  /** The user asked to finish before the microphone had opened. */
  private finishWhenOpen = false;
  /** Counts starts and teardowns: a mic that opens after one of them is dropped. */
  private generation = 0;
  private frame = 0;
  private dismissTimer: number | null = null;

  constructor(private readonly deps: PillControllerDeps) {
    this.store = deps.store ?? usePillStore;
    this.openMic = deps.openMic ?? openRealMic;
    this.earcons = deps.earcons ?? new Earcons();
  }

  /** Subscribes to the main process and announces that the page is ready. */
  start(): () => void {
    const { bridge } = this.deps;
    const offs = [
      bridge.on('dictation:start', (payload) => {
        void this.begin(payload);
      }),
      bridge.on('dictation:stop', ({ submit }) => {
        if (submit) this.requestFinish();
        else this.teardown();
      }),
      bridge.on('dictation:status', (status) => this.onStatus(status)),
      bridge.on('theme:changed', ({ theme }) => applyTheme(theme)),
    ];
    applyTheme(systemTheme());
    void bridge.invoke('dictation:ready').catch(() => undefined);
    return () => {
      for (const off of offs) off();
      this.teardown();
      this.earcons.dispose();
    };
  }

  /** The user pressed the microphone button: finish and transcribe what was said. */
  finishNow(): void {
    this.requestFinish();
  }

  /** The user pressed the close button or Esc. */
  cancel(): void {
    this.teardown();
    this.store.getState().setStatus({ phase: 'cancelled' });
    void this.deps.bridge.invoke('dictation:cancel').catch(() => undefined);
  }

  // ---- recording ----------------------------------------------------------------------------

  private async begin(payload: DictationStart): Promise<void> {
    this.teardown();
    const generation = this.generation;
    applyTheme(payload.theme);
    this.earconsOn = payload.earcons;
    this.opening = true;
    this.store.getState().begin({ language: payload.language, hotkey: payload.hotkey });

    let mic: MicSession;
    try {
      mic = await this.openMic(payload.micDeviceId);
    } catch (error) {
      if (generation !== this.generation) return;
      this.opening = false;
      this.play('error');
      await this.abort(abortReasonFor(error), error instanceof Error ? error.message : undefined);
      return;
    }
    // Cancelled, or started again, while the microphone was opening.
    if (generation !== this.generation) {
      mic.stop();
      return;
    }

    this.opening = false;
    this.mic = mic;
    const recording = new Recording({
      silenceMs: payload.silenceMs,
      maxSeconds: payload.maxSeconds,
      // The start beep leaks into the microphone: it is not part of the speech.
      discardMs: payload.earcons ? earconLength('start') * 1000 + 60 : 0,
    });
    this.recording = recording;
    mic.onSamples((chunk, rate) => this.onChunk(generation, recording, chunk, rate));
    this.store.getState().setPreparing(false);
    if (this.finishWhenOpen) {
      // Asked to finish while the microphone was still opening: nothing was said.
      this.finishWhenOpen = false;
      void this.finish({ grace: false });
      return;
    }
    this.play('start');
    this.trackLevel(generation, mic);
  }

  /** Finishes and transcribes; if the microphone is still opening, as soon as it has opened. */
  private requestFinish(): void {
    if (this.opening) this.finishWhenOpen = true;
    else void this.finish({ grace: true });
  }

  private onChunk(
    generation: number,
    recording: Recording,
    chunk: Float32Array,
    rate: number,
  ): void {
    if (generation !== this.generation || this.recording !== recording) return;
    const event = recording.push(chunk, rate);
    if (recording.hasSpeech) this.store.getState().setSpeaking(true);
    if (this.finishing) return;
    if (event === 'speech-end' || event === 'max-duration') void this.finish({ grace: false });
    else if (event === 'no-speech') void this.abort('no-speech');
  }

  private async finish(options: { grace: boolean }): Promise<void> {
    const recording = this.recording;
    if (!recording || this.finishing) return;
    this.finishing = true;
    const generation = this.generation;
    if (options.grace) await new Promise((resolve) => window.setTimeout(resolve, TAIL_GRACE_MS));
    if (generation !== this.generation) return;

    const samples = recording.finish();
    this.releaseMic();
    this.recording = null;
    this.play('stop');
    if (!samples) {
      await this.abort('no-speech');
      return;
    }
    this.store.getState().setStatus({ phase: 'transcribing' });
    try {
      await this.deps.bridge.invoke('dictation:submit', { samples });
    } catch (error) {
      await this.abort('error', error instanceof Error ? error.message : undefined);
    }
  }

  /** Tells the main process why there is nothing to submit; it shows the message. */
  private async abort(reason: DictationAbortReason, message?: string): Promise<void> {
    this.releaseMic();
    this.recording = null;
    try {
      await this.deps.bridge.invoke('dictation:abort', {
        reason,
        ...(message ? { message: message.slice(0, 300) } : {}),
      });
    } catch {
      this.store
        .getState()
        .setStatus({ phase: 'error', message: 'Dictation hit a problem. Try again' });
    }
  }

  /** Smooths the microphone level for the waveform (read every frame, never re-rendering). */
  private trackLevel(generation: number, mic: MicSession): void {
    let last = performance.now();
    const tick = (now: number): void => {
      if (generation !== this.generation || this.mic !== mic) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try {
        const rms = mic.readLevel();
        this.levelRef.current = smoothTowards(
          this.levelRef.current,
          Math.min(1, rms * 6),
          dt,
          0.04,
          0.2,
        );
      } catch {
        // The audio context may be closing; the next event ends the recording.
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  // ---- what the main process reports ----------------------------------------------------------

  private onStatus(status: DictationStatus): void {
    this.clearDismiss();
    this.store.getState().setStatus(status);
    if (status.phase === 'cancelled') {
      this.teardown();
      return;
    }
    if (status.phase === 'done' || status.phase === 'error') {
      // The dictation is over: a microphone that is still open or opening is not needed any more.
      this.teardown();
      // Let the result play its exit animation before the window disappears.
      const wait =
        status.phase === 'done' && !status.message ? DONE_VISIBLE_MS : MESSAGE_VISIBLE_MS;
      this.dismissTimer = window.setTimeout(() => this.store.getState().dismiss(), wait);
    }
  }

  // ---- cleanup ------------------------------------------------------------------------------

  private releaseMic(): void {
    cancelAnimationFrame(this.frame);
    this.mic?.stop();
    this.mic = null;
    this.levelRef.current = 0;
  }

  private teardown(): void {
    // A microphone that is still opening belongs to the dictation that is being torn down.
    this.generation += 1;
    this.opening = false;
    this.finishWhenOpen = false;
    this.releaseMic();
    this.recording = null;
    this.finishing = false;
    this.clearDismiss();
  }

  private clearDismiss(): void {
    if (this.dismissTimer !== null) window.clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
  }

  private play(kind: EarconKind): void {
    if (this.earconsOn) this.earcons.play(kind);
  }
}

import type { Bridge } from '@shared/ipc/bridge';
import type { WorkerConfig, WorkerStatus } from '@shared/ipc/types';
import { MIC_ERROR_HELP, MicError, openMic, type MicSession } from '@renderer/lib/voice/mic';
import { ModelHost, RecognitionSession } from '@renderer/lib/voice/recognizer';
import { containsWakePhrase, SpeechGate, WAKE_GRAMMAR } from './wake';

/** A recognition session is replaced after this long so its result list never grows unbounded. */
const ROTATE_AFTER_MS = 5 * 60_000;
const COOLDOWN_MS = 3000;
/** The model is released after this long without speech to give its memory back. */
const MODEL_IDLE_MS = 15 * 60_000;

/**
 * The hidden wake-word listener: microphone -> energy gate -> Vosk with a one-phrase grammar. It
 * runs only while the main process says it should (setting on, model ready, not paused) and reports
 * its state so the tray can show the "armed" icon. Audio never leaves this window.
 */
export class WakeWorker {
  private config: WorkerConfig | null = null;
  private paused = false;
  private mic: MicSession | null = null;
  private session: RecognitionSession | null = null;
  private readonly gate = new SpeechGate();
  private readonly models = new ModelHost();
  private runningWith: string | null = null;
  private cooldownUntil = 0;
  private rotateTimer: number | null = null;
  private applying = false;
  private again = false;

  constructor(private readonly bridge: Bridge<'worker'>) {}

  setConfig(config: WorkerConfig): void {
    this.config = config;
    void this.apply();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    void this.apply();
  }

  dispose(): void {
    this.stop();
    this.models.release();
  }

  /** Reconciles what is running with what the latest config/pause state wants (serialised). */
  private async apply(): Promise<void> {
    if (this.applying) {
      this.again = true;
      return;
    }
    this.applying = true;
    try {
      do {
        this.again = false;
        await this.reconcile();
      } while (this.again);
    } finally {
      this.applying = false;
    }
  }

  private async reconcile(): Promise<void> {
    const config = this.config;
    const wanted = Boolean(config?.enabled && config.modelUrl);
    if (!config || !wanted) {
      this.stop();
      await this.report({ state: 'off' });
      return;
    }
    if (this.paused) {
      this.stop();
      await this.report({ state: 'paused' });
      return;
    }
    const signature = `${config.micDeviceId}|${config.modelUrl ?? ''}`;
    if (this.mic && this.runningWith === signature) return;
    this.stop();
    await this.start(config, signature);
  }

  private async start(config: WorkerConfig, signature: string): Promise<void> {
    await this.report({ state: 'loading' });
    try {
      const modelUrl = config.modelUrl;
      if (!modelUrl) return;
      this.models.cancelRelease();
      const mic = await openMic(config.micDeviceId);
      this.mic = mic;
      this.runningWith = signature;
      this.openSession(modelUrl);
      mic.onSamples((samples, sampleRate) => {
        for (const [chunk, rate] of this.gate.push(samples, sampleRate)) {
          this.session?.feed(chunk, rate);
        }
      });
      this.rotateTimer = window.setInterval(() => this.openSession(modelUrl), ROTATE_AFTER_MS);
      await this.report({ state: 'armed' });
    } catch (error) {
      this.stop();
      const message =
        error instanceof MicError
          ? MIC_ERROR_HELP[error.kind]
          : error instanceof Error
            ? error.message
            : 'The wake word could not start.';
      await this.report({ state: 'error', message });
    }
  }

  private openSession(modelUrl: string): void {
    this.session?.close();
    this.gate.reset();
    this.session = new RecognitionSession(
      this.models,
      modelUrl,
      {
        onText: (text) => this.onText(text, modelUrl),
        onError: (message) => void this.report({ state: 'error', message }),
      },
      WAKE_GRAMMAR,
    );
  }

  private onText(text: string, modelUrl: string): void {
    if (!containsWakePhrase(text) || Date.now() < this.cooldownUntil) return;
    this.cooldownUntil = Date.now() + COOLDOWN_MS;
    void this.bridge
      .invoke('voice:wakeDetected', { phrase: 'hey beekeeper' })
      .catch(() => undefined);
    // A fresh session forgets the phrase so one utterance cannot trigger twice.
    this.openSession(modelUrl);
  }

  private stop(): void {
    if (this.rotateTimer !== null) {
      window.clearInterval(this.rotateTimer);
      this.rotateTimer = null;
    }
    this.mic?.stop();
    this.mic = null;
    this.session?.close();
    this.session = null;
    this.runningWith = null;
    this.gate.reset();
    this.models.scheduleRelease(MODEL_IDLE_MS);
  }

  private async report(status: WorkerStatus): Promise<void> {
    await this.bridge
      .invoke('voice:workerStatus', {
        state: status.state,
        ...(status.message ? { message: status.message } : {}),
      })
      .catch(() => undefined);
  }
}

import type { Logger } from '@shared/logger';
import type { WorkerConfig, WorkerStatus } from '@shared/ipc/types';
import type { Settings } from '@shared/settings';

/** Everything the controller needs from the app; injected so the decision logic is unit tested. */
export interface WakeWordDeps {
  getSettings: () => Settings;
  /** App-protocol URL of the voice model, null until it is downloaded and verified. */
  modelUrl: () => string | null;
  worker: {
    /** Creates the hidden worker window if needed and sends it the configuration. */
    run: (config: WorkerConfig, paused: boolean) => void;
    /** Closes the worker window (and with it the microphone). */
    stop: () => void;
  };
  publish: (status: WorkerStatus) => void;
  setArmed: (armed: boolean) => void;
  /** Opens the assistant bar and starts listening. */
  wake: () => void;
  batterySaverOn: () => Promise<boolean>;
  logger: Logger;
}

const PHRASES = ['hey beekeeper'];

/**
 * Decides when the wake-word worker runs (spec 4.3): only when the setting is on and the voice model
 * is ready, paused while the assistant bar is open (one microphone user at a time) and while Windows
 * Battery Saver is on (if the user wants that). It also relays what the worker reports.
 */
export class WakeWordController {
  private reported: WorkerStatus = { state: 'off' };
  private assistantOpen = false;
  private saverOn = false;
  private disposed = false;

  constructor(private readonly deps: WakeWordDeps) {}

  get status(): WorkerStatus {
    return this.reported;
  }

  /** Re-evaluates everything: call after settings, model state, power or assistant changes. */
  evaluate(): void {
    if (this.disposed) return;
    const { voice } = this.deps.getSettings();
    const modelUrl = this.deps.modelUrl();

    if (!voice.wakeWord) {
      this.shutDown({ state: 'off' });
      return;
    }
    if (modelUrl === null) {
      this.shutDown({ state: 'off', message: 'Download the voice model to use the wake word.' });
      return;
    }
    const paused = this.assistantOpen || (voice.wakeWordPauseOnBatterySaver && this.saverOn);
    this.deps.worker.run(
      { enabled: true, micDeviceId: voice.micDeviceId, modelUrl, phrases: PHRASES },
      paused,
    );
    if (paused && this.reported.state === 'armed') this.publish({ state: 'paused' });
  }

  /** The bar opened or closed: the worker lets go of the microphone while the bar listens. */
  setAssistantOpen(open: boolean): void {
    this.assistantOpen = open;
    this.evaluate();
  }

  /** Re-reads Battery Saver (call on power events); cheap no-op when the pause option is off. */
  async refreshPower(): Promise<void> {
    const { voice } = this.deps.getSettings();
    const next =
      voice.wakeWord && voice.wakeWordPauseOnBatterySaver
        ? await this.deps.batterySaverOn()
        : false;
    if (next === this.saverOn) return;
    this.saverOn = next;
    this.evaluate();
  }

  /** Status from the worker window. */
  handleStatus(status: WorkerStatus): void {
    if (!this.deps.getSettings().voice.wakeWord) return;
    if (status.state === 'error') this.deps.logger.warn('Wake word error', status.message ?? '');
    this.publish(status);
  }

  handleDetected(): void {
    const { voice } = this.deps.getSettings();
    if (!voice.wakeWord || this.assistantOpen) return;
    this.deps.logger.info('Wake word detected');
    this.deps.wake();
  }

  dispose(): void {
    this.disposed = true;
    this.deps.worker.stop();
    this.publish({ state: 'off' });
  }

  private shutDown(status: WorkerStatus): void {
    this.deps.worker.stop();
    this.publish(status);
  }

  private publish(status: WorkerStatus): void {
    const unchanged =
      status.state === this.reported.state && status.message === this.reported.message;
    this.reported = status;
    this.deps.setArmed(status.state === 'armed');
    if (!unchanged) this.deps.publish(status);
  }
}

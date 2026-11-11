import type { TrayController, TrayState } from './tray';

/** Combines "microphone active" and "wake word armed" into the one tray icon state. */
export class TrayStateMachine {
  private micActive = false;
  private wakeArmed = false;

  constructor(private readonly tray: Pick<TrayController, 'setState'>) {}

  setMicActive(active: boolean): void {
    this.micActive = active;
    this.apply();
  }

  setWakeArmed(armed: boolean): void {
    this.wakeArmed = armed;
    this.apply();
  }

  get state(): TrayState {
    if (this.micActive) return 'listening';
    return this.wakeArmed ? 'armed' : 'idle';
  }

  private apply(): void {
    this.tray.setState(this.state);
  }
}

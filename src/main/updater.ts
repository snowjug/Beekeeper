import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '@shared/ipc/types';
import type { Logger } from '@shared/logger';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20_000;

export interface UpdateControllerDeps {
  /** False in dev builds and for the portable build (it cannot replace itself). */
  enabled: boolean;
  /** Reason shown when updates are disabled. */
  disabledReason: string;
  autoUpdate: () => boolean;
  logger: Logger;
  onState: (state: UpdateState) => void;
}

/**
 * electron-updater against GitHub Releases: checks shortly after start-up and every 6 hours,
 * downloads in the background and reports "ready" so the UI can show "Update ready - restart".
 */
export class UpdateController {
  private state: UpdateState;
  private timer: NodeJS.Timeout | null = null;
  private wired = false;

  constructor(private readonly deps: UpdateControllerDeps) {
    this.state = deps.enabled
      ? { status: 'idle' }
      : { status: 'disabled', message: deps.disabledReason };
  }

  getState(): UpdateState {
    return this.state;
  }

  /** Status read through a method so TypeScript does not narrow it across awaits and callbacks. */
  private currentStatus(): UpdateState['status'] {
    return this.state.status;
  }

  /** Schedules the first check and the 6 hour interval. No-op when updates are disabled. */
  start(): void {
    if (!this.deps.enabled) return;
    this.wire();
    setTimeout(() => void this.check(false), FIRST_CHECK_DELAY_MS).unref();
    this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Manual or scheduled check; scheduled ones respect the auto-update setting. */
  async check(manual = true): Promise<UpdateState> {
    if (!this.deps.enabled) return this.state;
    if (!manual && !this.deps.autoUpdate()) return this.state;
    this.wire();
    if (this.currentStatus() === 'checking' || this.currentStatus() === 'downloading') {
      return this.state;
    }
    this.set({ status: 'checking' });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable && this.currentStatus() === 'checking') {
        this.set({ status: 'none' });
      }
    } catch (error) {
      this.deps.logger.warn('Update check failed', error);
      this.set({
        status: 'error',
        message: 'Could not check for updates. Are you online?',
      });
    }
    return this.state;
  }

  /** Quits and installs the downloaded update. */
  install(): void {
    if (this.state.status !== 'ready') return;
    autoUpdater.quitAndInstall(false, true);
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (info) =>
      this.set({ status: 'available', version: info.version }),
    );
    autoUpdater.on('update-not-available', () => this.set({ status: 'none' }));
    autoUpdater.on('download-progress', (progress) =>
      this.set({
        status: 'downloading',
        progress: Math.round(progress.percent),
        ...(this.state.version ? { version: this.state.version } : {}),
      }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ status: 'ready', version: info.version }),
    );
    autoUpdater.on('error', (error) => {
      this.deps.logger.warn('Updater error', error);
      this.set({ status: 'error', message: 'The update could not be downloaded.' });
    });
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.deps.onState(state);
  }
}

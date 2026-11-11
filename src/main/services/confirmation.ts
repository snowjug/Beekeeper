import { randomUUID } from 'node:crypto';
import type { ConfirmAction, ConfirmCard, CountdownCard } from '@shared/cards';
import { silentLogger, type Logger } from '@shared/logger';
import type { ConfirmRequest, ConfirmationService } from '../commands/types';
import { defaultClearTimer, defaultSetTimer, type ClearTimer, type SetTimer } from './timers';

/** A confirmation that is not answered within this time expires. */
export const CONFIRM_TTL_MS = 2 * 60 * 1000;
/** Finished confirmations are remembered briefly so a double click gets the same answer. */
const SETTLED_RETENTION_MS = 30_000;
const MAX_REASON_LENGTH = 160;

export type ConfirmOutcome =
  | { status: 'countdown'; card: CountdownCard }
  | { status: 'executed' }
  | { status: 'failed'; message: string }
  | { status: 'unknown' };

export interface ConfirmationSettledEvent {
  confirmId: string;
  action: ConfirmAction;
  status: 'executed' | 'failed' | 'cancelled' | 'expired';
  message?: string;
}

export interface ConfirmationServiceOptions {
  now?: () => number;
  newId?: () => string;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
  logger?: Logger;
  /** Called once when a request reaches a final state (executed, failed, cancelled, expired). */
  onSettled?: (event: ConfirmationSettledEvent) => void;
}

const COUNTDOWN_TITLES: Readonly<Record<ConfirmAction, string>> = {
  shutdown: 'Shutting down',
  restart: 'Restarting',
  sleep: 'Going to sleep',
  'empty-recycle-bin': 'Emptying the Recycle Bin',
  'force-close': 'Closing the app',
};

const FAILURE_PHRASES: Readonly<Record<ConfirmAction, string>> = {
  shutdown: 'shut down the PC',
  restart: 'restart the PC',
  sleep: 'put the PC to sleep',
  'empty-recycle-bin': 'empty the Recycle Bin',
  'force-close': 'close that app',
};

type Phase = 'pending' | 'counting' | 'running' | 'settled';

interface Entry {
  confirmId: string;
  request: ConfirmRequest;
  phase: Phase;
  /** Expiry timer while pending, countdown timer while counting. */
  timer: unknown;
  /** What the first confirm() call received; later calls get the same answer. */
  first?: Promise<ConfirmOutcome>;
  final?: ConfirmOutcome;
  settledAt?: number;
}

function failureMessage(action: ConfirmAction, error: unknown): string {
  const reason = error instanceof Error ? error.message.trim().slice(0, MAX_REASON_LENGTH) : '';
  return `I couldn't ${FAILURE_PHRASES[action]}.${reason === '' ? '' : ` ${reason}`}`;
}

/**
 * Pending risky actions. The user confirms with a button; power actions then run after a
 * cancellable countdown. An action never runs twice, however often it is confirmed.
 */
export class ConfirmationServiceImpl implements ConfirmationService {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly setTimer: SetTimer;
  private readonly clearTimer: ClearTimer;
  private readonly logger: Logger;
  private readonly onSettled: ((event: ConfirmationSettledEvent) => void) | undefined;

  constructor(options: ConfirmationServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    this.setTimer = options.setTimer ?? defaultSetTimer;
    this.clearTimer = options.clearTimer ?? defaultClearTimer;
    this.logger = options.logger ?? silentLogger;
    this.onSettled = options.onSettled;
  }

  request(request: ConfirmRequest): ConfirmCard {
    this.dropStale();
    const confirmId = this.newId();
    const entry: Entry = {
      confirmId,
      request,
      phase: 'pending',
      timer: this.setTimer(() => {
        this.expire(confirmId);
      }, CONFIRM_TTL_MS),
    };
    this.entries.set(confirmId, entry);

    const card: ConfirmCard = {
      kind: 'confirm',
      id: this.newId(),
      createdAt: this.now(),
      confirmId,
      action: request.action,
      title: request.title,
      confirmLabel: request.confirmLabel,
      danger: request.danger,
    };
    if (request.detail !== undefined) card.detail = request.detail;
    const countdownMs = this.countdownMs(request);
    if (countdownMs > 0) card.countdownSeconds = countdownMs / 1000;
    return card;
  }

  /**
   * The user pressed the confirm button. Starts the countdown (outcome "countdown") or runs the
   * action right away. Repeated calls return the first answer and never run the action twice.
   */
  confirm(confirmId: string): Promise<ConfirmOutcome> {
    this.dropStale();
    const entry = this.entries.get(confirmId);
    if (entry === undefined) return Promise.resolve({ status: 'unknown' });
    if (entry.phase === 'settled') return Promise.resolve(entry.final ?? { status: 'unknown' });
    if (entry.first !== undefined) return entry.first;

    this.clearTimer(entry.timer);
    entry.first =
      this.countdownMs(entry.request) > 0 ? this.startCountdown(entry) : this.execute(entry);
    return entry.first;
  }

  /** Cancels a pending or counting-down request. False when it is unknown or already running. */
  cancel(confirmId: string): boolean {
    const entry = this.entries.get(confirmId);
    if (entry === undefined || (entry.phase !== 'pending' && entry.phase !== 'counting')) {
      return false;
    }
    this.clearTimer(entry.timer);
    this.entries.delete(confirmId);
    this.notify({ confirmId, action: entry.request.action, status: 'cancelled' });
    return true;
  }

  /** Cancels everything that has not run yet; returns how many requests were cancelled. */
  cancelAll(): number {
    let cancelled = 0;
    for (const confirmId of [...this.entries.keys()]) {
      if (this.cancel(confirmId)) cancelled += 1;
    }
    return cancelled;
  }

  /** Requests waiting for a click or counting down. */
  pendingCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.phase === 'pending' || entry.phase === 'counting') count += 1;
    }
    return count;
  }

  private countdownMs(request: ConfirmRequest): number {
    const seconds = request.countdownSeconds;
    return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  private startCountdown(entry: Entry): Promise<ConfirmOutcome> {
    const { request, confirmId } = entry;
    const duration = this.countdownMs(request);
    const startedAt = this.now();
    entry.phase = 'counting';
    entry.timer = this.setTimer(() => {
      void this.execute(entry);
    }, duration);

    const card: CountdownCard = {
      kind: 'countdown',
      id: this.newId(),
      createdAt: startedAt,
      confirmId,
      action: request.action,
      title: COUNTDOWN_TITLES[request.action],
      startedAt,
      endsAt: startedAt + duration,
    };
    if (request.detail !== undefined) card.detail = request.detail;
    return Promise.resolve({ status: 'countdown', card });
  }

  private async execute(entry: Entry): Promise<ConfirmOutcome> {
    const alive = this.entries.get(entry.confirmId) === entry;
    if (!alive || entry.phase === 'running' || entry.phase === 'settled') {
      return entry.final ?? { status: 'unknown' };
    }
    entry.phase = 'running';
    let outcome: ConfirmOutcome;
    try {
      await entry.request.run();
      outcome = { status: 'executed' };
    } catch (error) {
      this.logger.error('Confirmed action failed', entry.request.action, error);
      outcome = { status: 'failed', message: failureMessage(entry.request.action, error) };
    }
    entry.phase = 'settled';
    entry.final = outcome;
    entry.settledAt = this.now();
    this.notify({
      confirmId: entry.confirmId,
      action: entry.request.action,
      status: outcome.status === 'failed' ? 'failed' : 'executed',
      ...(outcome.status === 'failed' ? { message: outcome.message } : {}),
    });
    return outcome;
  }

  private expire(confirmId: string): void {
    const entry = this.entries.get(confirmId);
    if (entry === undefined || entry.phase !== 'pending') return;
    this.entries.delete(confirmId);
    this.notify({
      confirmId,
      action: entry.request.action,
      status: 'expired',
      message: 'That confirmation expired. Ask again if you still want to do it.',
    });
  }

  private dropStale(): void {
    const cutoff = this.now() - SETTLED_RETENTION_MS;
    for (const [confirmId, entry] of this.entries) {
      if (entry.phase === 'settled' && (entry.settledAt ?? 0) < cutoff) {
        this.entries.delete(confirmId);
      }
    }
  }

  private notify(event: ConfirmationSettledEvent): void {
    if (this.onSettled === undefined) return;
    try {
      this.onSettled(event);
    } catch (error) {
      this.logger.error('Confirmation listener failed', error);
    }
  }
}

export function createConfirmationService(
  options: ConfirmationServiceOptions = {},
): ConfirmationServiceImpl {
  return new ConfirmationServiceImpl(options);
}

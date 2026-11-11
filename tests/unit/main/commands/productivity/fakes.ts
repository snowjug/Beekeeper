import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { silentLogger } from '@shared/logger';
import type { CommandResult, ConversationTurn } from '@shared/cards';
import type {
  AnyCommandModule,
  CommandServices,
  CommandSettings,
  ParseContext,
  RunContext,
  UiBridge,
} from '@main/commands/types';
import { normalizeInput } from '@main/commands/text';
import { JsonStore } from '@main/services/jsonStore';
import { createNotesService, emptyNotesFile } from '@main/services/notes';
import { createTimersService, emptyTimersFile } from '@main/services/timers';

interface ScheduledTimer {
  fn: () => void;
  at: number;
}

/** Deterministic clock plus setTimeout/clearTimeout replacements for service tests. */
export class FakeClock {
  time: number;
  /** Longest delay ever requested from setTimer. */
  longestDelay = 0;
  private nextHandle = 1;
  private readonly scheduled = new Map<number, ScheduledTimer>();

  constructor(start: number) {
    this.time = start;
  }

  readonly now = (): number => this.time;

  readonly setTimer = (fn: () => void, delay: number): unknown => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.longestDelay = Math.max(this.longestDelay, delay);
    this.scheduled.set(handle, { fn, at: this.time + delay });
    return handle;
  };

  readonly clearTimer = (handle: unknown): void => {
    this.scheduled.delete(handle as number);
  };

  /** Number of timers waiting to fire. */
  get pending(): number {
    return this.scheduled.size;
  }

  /** Delays (ms from now) of all waiting timers, soonest first. */
  remaining(): number[] {
    return [...this.scheduled.values()].map((timer) => timer.at - this.time).sort((a, b) => a - b);
  }

  /** Moves time forward and runs every timer that becomes due, in order. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let next: [number, ScheduledTimer] | undefined;
      for (const entry of this.scheduled) {
        if (entry[1].at <= target && (next === undefined || entry[1].at < next[1].at)) next = entry;
      }
      if (next === undefined) break;
      this.scheduled.delete(next[0]);
      this.time = Math.max(this.time, next[1].at);
      next[1].fn();
    }
    this.time = target;
  }

  /** Moves time forward without running timers, like a PC that was asleep. */
  jump(ms: number): void {
    this.time += ms;
  }
}

const memoryFiles: string[] = [];

/** `dispose()` and `flushSync()` write the file once, so every test run removes what it created. */
afterEach(() => {
  for (const file of memoryFiles.splice(0)) rmSync(file, { force: true });
});

/** A JsonStore that is not written to disk unless the test flushes it (the debounce is an hour). */
export function memoryStore<T>(defaults: () => T): JsonStore<T> {
  const filePath = join(tmpdir(), `beekeeper-memory-${randomUUID()}.json`);
  memoryFiles.push(filePath);
  return new JsonStore<T>({ filePath, defaults, debounceMs: 3_600_000 });
}

/** Tuesday 10 November 2026, 16:22:36 (local time). */
export const NOW = new Date(2026, 10, 10, 16, 22, 36);

export class FakeUi implements UiBridge {
  copied: string[] = [];
  lastAnswer: string | null = null;
  copyError: Error | null = null;

  openSettings(): void {}
  openCircleToSearch(): void {}
  startCapture(): void {}
  openCaptureStudio(): void {}
  startDictation(): void {}
  stopSpeaking(): void {}
  cancelPending(): { confirmations: number; streams: number } {
    return { confirmations: 0, streams: 0 };
  }
  copyToClipboard(text: string): void {
    if (this.copyError !== null) throw this.copyError;
    this.copied.push(text);
  }
  getLastAnswerText(): string | null {
    return this.lastAnswer;
  }
  openExternal(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** A service the productivity commands must never touch. */
function unused<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, property) => {
      throw new Error(`${name}.${String(property)} is not available to productivity commands`);
    },
  });
}

const SETTINGS: CommandSettings = {
  units: 'metric',
  weatherLocation: { mode: 'auto', city: '' },
  aiConfigured: false,
};

/** Real timers/notes services on a fake clock with in-memory stores, plus a fake UI. */
export function createHarness(start: Date = NOW) {
  const clock = new FakeClock(start.getTime());
  let ids = 0;
  const newId = (): string => {
    ids += 1;
    return `id${ids}`;
  };
  let timerIds = 0;
  const timersStore = memoryStore(emptyTimersFile);
  const timers = createTimersService({
    store: timersStore,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    newId: () => {
      timerIds += 1;
      return `t${timerIds}`;
    },
  });
  let noteIds = 0;
  const notes = createNotesService({
    store: memoryStore(emptyNotesFile),
    now: clock.now,
    newId: () => {
      noteIds += 1;
      return `n${noteIds}`;
    },
  });
  const ui = new FakeUi();
  const services: CommandServices = {
    system: unused('system'),
    weather: unused('weather'),
    dictionary: unused('dictionary'),
    notes,
    timers,
    history: unused('history'),
    confirm: unused('confirm'),
    ui,
    listCommands: () => [],
  };

  return {
    clock,
    timers,
    timersStore,
    notes,
    ui,
    services,
    /** Context for `match`; `turns` are the previous conversation turns. */
    parseContext(turns: readonly ConversationTurn[] = []): ParseContext {
      return { now: new Date(clock.time), turns };
    },
    /** Context for `run`. */
    runContext(): RunContext {
      return {
        now: new Date(clock.time),
        turns: [],
        settings: SETTINGS,
        services,
        logger: silentLogger,
        signal: new AbortController().signal,
        newId,
      };
    },
  };
}

export type Harness = ReturnType<typeof createHarness>;

/** Parses `text` with `command` and runs it; fails the test when the command does not match. */
export async function execute(
  harness: Harness,
  command: AnyCommandModule,
  text: string,
  turns: readonly ConversationTurn[] = [],
): Promise<CommandResult> {
  const match = command.match(normalizeInput(text), harness.parseContext(turns));
  if (match === null) throw new Error(`${command.id} did not match "${text}"`);
  return command.run(match.slots, harness.runContext());
}

/** The turn the engine would remember after `result` was shown for `commandId`. */
export function turnAfter(
  harness: Harness,
  commandId: string,
  result: CommandResult,
  text = 'previous request',
): ConversationTurn {
  const turn: ConversationTurn = { id: 'turn', at: harness.clock.time, text, commandId };
  if (result.context !== undefined) turn.context = result.context;
  return turn;
}

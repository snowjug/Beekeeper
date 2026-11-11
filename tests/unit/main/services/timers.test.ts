import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimerRecord } from '@main/commands/types';
import type { JsonStore } from '@main/services/jsonStore';
import {
  createTimersService,
  emptyTimersFile,
  openTimersStore,
  parseTimersFile,
  type StoredTimer,
  type TimersFile,
} from '@main/services/timers';
import { FakeClock, memoryStore } from '../commands/productivity/fakes';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_TIMEOUT = 2_147_483_647;
const START = Date.UTC(2026, 10, 10, 10, 0, 0);

interface Fired {
  record: TimerRecord;
  missed: boolean;
}

function setup(store: JsonStore<TimersFile> = memoryStore(emptyTimersFile), clock?: FakeClock) {
  const time = clock ?? new FakeClock(START);
  let counter = 0;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const timers = createTimersService({
    store,
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    newId: () => {
      counter += 1;
      return `t${counter}`;
    },
    logger,
  });
  const fired: Fired[] = [];
  timers.onFire((record, info) => fired.push({ record, missed: info.missed }));
  return { clock: time, store, timers, fired, logger };
}

function stored(overrides: Partial<StoredTimer> & Pick<StoredTimer, 'id' | 'endsAt'>): StoredTimer {
  return {
    type: 'reminder',
    label: overrides.id,
    durationMs: 10 * MINUTE,
    startedAt: overrides.endsAt - 10 * MINUTE,
    state: 'running',
    ...overrides,
  };
}

function storeWith(records: StoredTimer[]): JsonStore<TimersFile> {
  const store = memoryStore(emptyTimersFile);
  store.set({ version: 1, records });
  return store;
}

describe('starting timers', () => {
  it('creates a running record with the default label', () => {
    const { timers } = setup();
    expect(timers.startTimer({ durationMs: 5 * MINUTE })).toEqual({
      id: 't1',
      type: 'timer',
      label: 'Timer',
      durationMs: 5 * MINUTE,
      startedAt: START,
      endsAt: START + 5 * MINUTE,
      state: 'running',
    });
  });

  it('trims and caps labels', () => {
    const { timers } = setup();
    expect(timers.startTimer({ durationMs: MINUTE, label: '  pasta  ' }).label).toBe('pasta');
    expect(timers.startTimer({ durationMs: MINUTE, label: '   ' }).label).toBe('Timer');
    expect(timers.startTimer({ durationMs: MINUTE, label: 'x'.repeat(500) }).label).toHaveLength(
      200,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a duration of %d',
    (durationMs) => {
      const { timers } = setup();
      expect(() => timers.startTimer({ durationMs })).toThrow(RangeError);
    },
  );

  it('runs several timers at once and lists the soonest first', () => {
    const { timers, clock } = setup();
    const long = timers.startTimer({ durationMs: 10 * MINUTE });
    const short = timers.startTimer({ durationMs: 2 * MINUTE });
    const middle = timers.startTimer({ durationMs: 5 * MINUTE });
    expect(timers.list().map((record) => record.id)).toEqual([short.id, middle.id, long.id]);
    expect(clock.pending).toBe(3);
  });

  it('orders records that are due at the same moment by when they were created', () => {
    const { timers, clock } = setup();
    const timer = timers.startTimer({ durationMs: 10 * MINUTE });
    clock.advance(MINUTE);
    const reminder = timers.schedule({ at: START + 10 * MINUTE, label: 'x', type: 'reminder' });
    expect(timers.list().map((record) => record.id)).toEqual([timer.id, reminder.id]);
  });

  it('hands out copies, not its internal state', () => {
    const { timers } = setup();
    const record = timers.startTimer({ durationMs: MINUTE });
    record.label = 'tampered';
    timers.list().forEach((entry) => {
      entry.label = 'tampered';
    });
    expect(timers.list()[0]?.label).toBe('Timer');
  });

  it('schedules reminders and alarms at an absolute time', () => {
    const { timers } = setup();
    const reminder = timers.schedule({ at: START + HOUR, label: ' call mom ', type: 'reminder' });
    const alarm = timers.schedule({ at: START + 2 * HOUR, label: '', type: 'alarm' });
    expect(reminder).toMatchObject({
      type: 'reminder',
      label: 'call mom',
      durationMs: HOUR,
      endsAt: START + HOUR,
      state: 'running',
    });
    expect(alarm).toMatchObject({ type: 'alarm', label: 'Alarm' });
    expect(timers.schedule({ at: START + 3 * HOUR, label: '', type: 'reminder' }).label).toBe(
      'Reminder',
    );
  });

  it('rejects a scheduled time that is not a timestamp', () => {
    const { timers } = setup();
    expect(() => timers.schedule({ at: Number.NaN, label: 'x', type: 'reminder' })).toThrow(
      RangeError,
    );
  });
});

describe('firing', () => {
  it('fires concurrent timers in order and marks them done', () => {
    const { timers, clock, fired } = setup();
    const long = timers.startTimer({ durationMs: 10 * MINUTE });
    const short = timers.startTimer({ durationMs: 2 * MINUTE });
    const middle = timers.startTimer({ durationMs: 5 * MINUTE, label: 'tea' });

    clock.advance(2 * MINUTE);
    expect(fired.map((entry) => entry.record.id)).toEqual([short.id]);
    expect(fired[0]).toMatchObject({ missed: false, record: { state: 'done', type: 'timer' } });
    expect(timers.list().map((record) => record.id)).toEqual([middle.id, long.id]);

    clock.advance(8 * MINUTE);
    expect(fired.map((entry) => entry.record.id)).toEqual([short.id, middle.id, long.id]);
    expect(fired.every((entry) => !entry.missed)).toBe(true);
    expect(timers.list()).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('keeps a fired record for an hour and then prunes it', () => {
    const { timers, clock } = setup();
    const record = timers.startTimer({ durationMs: MINUTE });
    clock.advance(MINUTE);
    expect(timers.get(record.id)).toMatchObject({ id: record.id, state: 'done' });

    clock.advance(59 * MINUTE);
    expect(timers.get(record.id)).not.toBeNull();
    clock.advance(2 * MINUTE);
    expect(timers.get(record.id)).toBeNull();
  });

  it('fires something scheduled in the past on the next tick', () => {
    const { timers, clock, fired } = setup();
    const record = timers.schedule({ at: START - 5_000, label: 'late', type: 'reminder' });
    expect(record.durationMs).toBe(0);
    clock.advance(0);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.missed).toBe(false);
  });

  it('never fires early when a timer callback runs ahead of the clock', () => {
    const clock = new FakeClock(START);
    const callbacks: Array<{ fn: () => void; delay: number }> = [];
    const timers = createTimersService({
      store: memoryStore(emptyTimersFile),
      now: clock.now,
      setTimer: (fn, delay) => {
        callbacks.push({ fn, delay });
        return callbacks.length;
      },
      clearTimer: () => undefined,
    });
    const fired: TimerRecord[] = [];
    timers.onFire((record) => fired.push(record));
    timers.startTimer({ durationMs: 10_000 });

    callbacks[0]?.fn();
    expect(fired).toHaveLength(0);
    expect(callbacks.map((entry) => entry.delay)).toEqual([10_000, 10_000]);

    clock.jump(10_000);
    callbacks[1]?.fn();
    expect(fired).toHaveLength(1);
    expect(timers.list()).toEqual([]);
  });
  it('does not fire a record that was cancelled while its timer was still pending', () => {
    const clock = new FakeClock(START);
    const callbacks: Array<() => void> = [];
    const timers = createTimersService({
      store: memoryStore(emptyTimersFile),
      now: clock.now,
      setTimer: (fn) => {
        callbacks.push(fn);
        return callbacks.length;
      },
      clearTimer: () => undefined,
    });
    const fired: TimerRecord[] = [];
    timers.onFire((record) => fired.push(record));

    const record = timers.startTimer({ durationMs: MINUTE });
    timers.cancel(record.id);
    clock.jump(MINUTE);
    callbacks[0]?.();
    expect(fired).toEqual([]);
  });
});

describe('cancelling', () => {
  it('removes a running record and stops its timer', () => {
    const { timers, clock, fired, store } = setup();
    const keep = timers.startTimer({ durationMs: 5 * MINUTE });
    const drop = timers.startTimer({ durationMs: 3 * MINUTE });

    expect(timers.cancel(drop.id)).toBe(true);
    expect(timers.cancel(drop.id)).toBe(false);
    expect(timers.cancel('missing')).toBe(false);
    expect(timers.list().map((record) => record.id)).toEqual([keep.id]);
    expect(store.get().records.map((record) => record.id)).toEqual([keep.id]);
    expect(clock.pending).toBe(1);

    clock.advance(10 * MINUTE);
    expect(fired.map((entry) => entry.record.id)).toEqual([keep.id]);
  });

  it('cannot cancel a record that already fired', () => {
    const { timers, clock } = setup();
    const record = timers.startTimer({ durationMs: MINUTE });
    clock.advance(MINUTE);
    expect(timers.cancel(record.id)).toBe(false);
    expect(timers.get(record.id)?.state).toBe('done');
  });

  it('cancels everything that is running and reports how many', () => {
    const { timers, clock, fired } = setup();
    const done = timers.startTimer({ durationMs: MINUTE });
    timers.startTimer({ durationMs: 5 * MINUTE });
    timers.schedule({ at: START + HOUR, label: 'x', type: 'reminder' });
    clock.advance(MINUTE);

    expect(timers.cancelAll()).toBe(2);
    expect(timers.cancelAll()).toBe(0);
    expect(timers.list()).toEqual([]);
    expect(timers.get(done.id)?.state).toBe('done');
    expect(clock.pending).toBe(0);

    clock.advance(DAY);
    expect(fired.map((entry) => entry.record.id)).toEqual([done.id]);
  });
});

describe('listeners', () => {
  it('delivers to every listener and supports unsubscribing', () => {
    const { timers, clock } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = timers.onFire(first);
    timers.onFire(second);

    timers.startTimer({ durationMs: MINUTE });
    clock.advance(MINUTE);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    timers.startTimer({ durationMs: MINUTE });
    clock.advance(MINUTE);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('keeps firing when a listener throws', () => {
    const { timers, clock, logger } = setup();
    const after = vi.fn();
    timers.onFire(() => {
      throw new Error('boom');
    });
    timers.onFire(after);

    timers.startTimer({ durationMs: MINUTE });
    timers.startTimer({ durationMs: 2 * MINUTE });
    clock.advance(2 * MINUTE);
    expect(after).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('notifies change listeners about every change', () => {
    const { timers, clock, logger } = setup();
    const onChange = vi.fn();
    const off = timers.onChange(onChange);
    timers.onChange(() => {
      throw new Error('ui gone');
    });

    const a = timers.startTimer({ durationMs: MINUTE });
    timers.schedule({ at: START + HOUR, label: 'x', type: 'alarm' });
    expect(onChange).toHaveBeenCalledTimes(2);
    timers.cancel(a.id);
    expect(onChange).toHaveBeenCalledTimes(3);
    timers.startTimer({ durationMs: MINUTE });
    clock.advance(MINUTE);
    expect(onChange).toHaveBeenCalledTimes(5);
    timers.cancelAll();
    expect(onChange).toHaveBeenCalledTimes(6);
    expect(logger.error).toHaveBeenCalled();

    off();
    timers.startTimer({ durationMs: MINUTE });
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('allows a fire listener to use the service', () => {
    const { timers, clock, fired } = setup();
    timers.onFire((record) => {
      if (record.type === 'timer') {
        timers.schedule({ at: START + HOUR, label: 'follow up', type: 'reminder' });
        timers.cancelAll();
      }
    });
    timers.startTimer({ durationMs: MINUTE });
    clock.advance(MINUTE);
    expect(fired).toHaveLength(1);
    expect(timers.list()).toEqual([]);
  });
});

describe('start (restart and resume)', () => {
  it('fires overdue records once as missed, arms the rest and prunes old ones', () => {
    const store = storeWith([
      stored({ id: 'future', endsAt: START + 20 * MINUTE }),
      stored({ id: 'overdue-b', endsAt: START - 5 * MINUTE, type: 'timer' }),
      stored({ id: 'overdue-a', endsAt: START - 10 * MINUTE }),
      stored({
        id: 'done-old',
        endsAt: START - 3 * HOUR,
        state: 'done',
        firedAt: START - 2 * HOUR,
      }),
      stored({ id: 'done-new', endsAt: START - HOUR, state: 'done', firedAt: START - 10 * MINUTE }),
    ]);
    const { timers, clock, fired } = setup(store);

    timers.start();
    expect(fired.map((entry) => [entry.record.id, entry.missed])).toEqual([
      ['overdue-a', true],
      ['overdue-b', true],
    ]);
    expect(fired.every((entry) => entry.record.state === 'done')).toBe(true);
    expect(clock.remaining()).toEqual([20 * MINUTE]);
    expect(timers.list().map((record) => record.id)).toEqual(['future']);
    expect(timers.get('done-old')).toBeNull();
    expect(timers.get('done-new')?.state).toBe('done');
    expect(timers.get('overdue-a')?.state).toBe('done');

    clock.advance(20 * MINUTE);
    expect(fired.map((entry) => entry.record.id)).toEqual(['overdue-a', 'overdue-b', 'future']);
    expect(fired[2]?.missed).toBe(false);
  });

  it('is safe to call repeatedly: no double fire, one JS timer per record', () => {
    const store = storeWith([
      stored({ id: 'overdue', endsAt: START - MINUTE }),
      stored({ id: 'future', endsAt: START + MINUTE }),
    ]);
    const { timers, clock, fired } = setup(store);
    timers.start();
    timers.start();
    timers.start();
    expect(fired.map((entry) => entry.record.id)).toEqual(['overdue']);
    expect(clock.pending).toBe(1);

    clock.advance(MINUTE);
    expect(fired.map((entry) => entry.record.id)).toEqual(['overdue', 'future']);
  });

  it('re-arms after the PC slept through a timer', () => {
    const { timers, clock, fired } = setup();
    const due = timers.startTimer({ durationMs: 10 * MINUTE });
    const later = timers.startTimer({ durationMs: 30 * MINUTE });

    clock.jump(20 * MINUTE);
    expect(fired).toHaveLength(0);
    timers.start();

    expect(fired.map((entry) => [entry.record.id, entry.missed])).toEqual([[due.id, true]]);
    expect(clock.remaining()).toEqual([10 * MINUTE]);
    clock.advance(10 * MINUTE);
    expect(fired.map((entry) => [entry.record.id, entry.missed])).toEqual([
      [due.id, true],
      [later.id, false],
    ]);
  });

  it('does nothing when there are no records', () => {
    const { timers, clock, fired } = setup();
    timers.start();
    expect(fired).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('skips an overdue record that a listener cancelled during delivery', () => {
    const store = storeWith([
      stored({ id: 'a', endsAt: START - 2 * MINUTE }),
      stored({ id: 'b', endsAt: START - MINUTE }),
    ]);
    const { timers, fired } = setup(store);
    timers.onFire((record) => {
      if (record.id === 'a') timers.cancel('b');
    });
    timers.start();
    expect(fired.map((entry) => entry.record.id)).toEqual(['a']);
    expect(timers.get('b')).toBeNull();
  });

  it('delivers every missed record even if a listener throws', () => {
    const store = storeWith([
      stored({ id: 'a', endsAt: START - 2 * MINUTE }),
      stored({ id: 'b', endsAt: START - MINUTE }),
    ]);
    const { timers, fired } = setup(store);
    timers.onFire(() => {
      throw new Error('nope');
    });
    timers.start();
    expect(fired.map((entry) => entry.record.id)).toEqual(['a', 'b']);
  });
});

describe('long delays', () => {
  it('re-arms in chunks below the 32-bit setTimeout limit', () => {
    const { timers, clock, fired } = setup();
    const reminder = timers.schedule({ at: START + 40 * DAY, label: 'renew', type: 'reminder' });
    expect(clock.remaining()).toEqual([MAX_TIMEOUT]);

    clock.advance(39 * DAY);
    expect(fired).toHaveLength(0);
    expect(clock.longestDelay).toBeLessThanOrEqual(MAX_TIMEOUT);

    clock.advance(DAY - 1);
    expect(fired).toHaveLength(0);
    clock.advance(1);
    expect(fired.map((entry) => [entry.record.id, entry.missed])).toEqual([[reminder.id, false]]);
    expect(clock.longestDelay).toBeLessThanOrEqual(MAX_TIMEOUT);
  });
});

describe('dispose', () => {
  it('stops timers and listeners and keeps the records', () => {
    const { timers, clock, fired, store } = setup();
    const onChange = vi.fn();
    timers.onChange(onChange);
    timers.startTimer({ durationMs: MINUTE });
    onChange.mockClear();

    timers.dispose();
    expect(clock.pending).toBe(0);
    clock.advance(DAY);
    expect(fired).toHaveLength(0);
    expect(store.get().records).toHaveLength(1);

    timers.startTimer({ durationMs: MINUTE });
    timers.start();
    expect(clock.pending).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('persistence', () => {
  let dir: string;
  let filePath: string;
  const opened: Array<JsonStore<TimersFile>> = [];

  function open(): JsonStore<TimersFile> {
    const store = openTimersStore(filePath);
    opened.push(store);
    return store;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beekeeper-timers-'));
    filePath = join(dir, 'timers.json');
  });

  afterEach(() => {
    for (const store of opened.splice(0)) store.flushSync();
    rmSync(dir, { recursive: true, force: true });
  });

  it('survives a restart: overdue fires as missed, future is re-armed', async () => {
    const first = setup(open());
    const soon = first.timers.startTimer({ durationMs: 5 * MINUTE, label: 'tea' });
    const later = first.timers.schedule({ at: START + HOUR, label: 'call mom', type: 'reminder' });
    await first.store.flush();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      version: 1,
      records: [{ id: soon.id }, { id: later.id }],
    });

    const clock = new FakeClock(START + 10 * MINUTE);
    const second = setup(open(), clock);
    second.timers.start();
    expect(second.fired.map((entry) => [entry.record.label, entry.missed])).toEqual([
      ['tea', true],
    ]);
    expect(clock.remaining()).toEqual([50 * MINUTE]);

    clock.advance(50 * MINUTE);
    expect(second.fired.map((entry) => entry.record.label)).toEqual(['tea', 'call mom']);
    await second.store.flush();

    const third = setup(open(), new FakeClock(START + 90 * MINUTE));
    third.timers.start();
    expect(third.fired).toEqual([]);
    expect(third.timers.get(soon.id)).toBeNull();
    expect(third.timers.get(later.id)?.state).toBe('done');
  });

  it('removes cancelled records from disk', async () => {
    const { timers, store } = setup(open());
    const record = timers.startTimer({ durationMs: MINUTE });
    timers.cancel(record.id);
    await store.flush();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ version: 1, records: [] });
  });

  it('writes pending changes when disposed', () => {
    const { timers } = setup(open());
    timers.startTimer({ durationMs: MINUTE });
    expect(existsSync(filePath)).toBe(false);
    timers.dispose();
    expect(existsSync(filePath)).toBe(true);
  });

  it('starts empty after a damaged file', () => {
    writeFileSync(filePath, '{"version":2,"records":[]}', 'utf8');
    expect(open().get()).toEqual(emptyTimersFile());
  });
});

describe('parseTimersFile', () => {
  it('keeps valid records and drops damaged ones', () => {
    const good = stored({ id: 'ok', endsAt: START, firedAt: START + 1 });
    const parsed = parseTimersFile({
      version: 1,
      records: [
        good,
        { ...good, id: '' },
        { ...good, id: 'bad-type', type: 'stopwatch' },
        { ...good, id: 'cancelled', state: 'cancelled' },
        { ...good, id: 'nan', endsAt: Number.NaN },
        { ...good, id: 'no-label', label: undefined },
        null,
        'text',
      ],
    });
    expect(parsed).toEqual({ version: 1, records: [good] });
  });

  it('rejects files that are not timers documents', () => {
    expect(() => parseTimersFile(null)).toThrow();
    expect(() => parseTimersFile([])).toThrow();
    expect(() => parseTimersFile({ version: 2, records: [] })).toThrow();
    expect(() => parseTimersFile({ version: 1, records: 'x' })).toThrow();
  });
});

describe('with real timers', () => {
  it('fires after the delay and can be cancelled', async () => {
    const timers = createTimersService({ store: memoryStore(emptyTimersFile) });
    const fired: string[] = [];
    timers.onFire((record) => fired.push(record.label));

    timers.startTimer({ durationMs: 20, label: 'quick' });
    const cancelled = timers.startTimer({ durationMs: 40, label: 'cancelled' });
    expect(timers.cancel(cancelled.id)).toBe(true);

    await vi.waitFor(() => expect(fired).toEqual(['quick']));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fired).toEqual(['quick']);
    timers.dispose();
  });
});

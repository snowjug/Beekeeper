import { describe, expect, it, vi } from 'vitest';
import type { StatusCard, TimerCard } from '@shared/cards';
import { timerCommand } from '@main/commands/productivity/timer';
import { normalizeInput } from '@main/commands/text';
import { NOW, createHarness, execute, turnAfter } from './fakes';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function timerCards(cards: unknown[]): TimerCard[] {
  return cards.filter((card): card is TimerCard => (card as TimerCard).kind === 'timer');
}

describe('starting a timer', () => {
  it('starts a timer, shows its card and pins the bar', async () => {
    const h = createHarness();
    const result = await execute(h, timerCommand, 'set a timer for 5 minutes');

    expect(result.speech).toBe('Timer set for 5 minutes');
    expect(result.pin).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      kind: 'timer',
      timerId: 't1',
      timerType: 'timer',
      label: 'Timer',
      durationMs: 5 * MINUTE,
      startedAt: NOW.getTime(),
      endsAt: NOW.getTime() + 5 * MINUTE,
      state: 'running',
    });
    expect(h.timers.list()).toHaveLength(1);
  });

  it('keeps a spoken label', async () => {
    const h = createHarness();
    const result = await execute(h, timerCommand, 'timer for five minutes called pasta');
    expect(result.speech).toBe('Timer set for 5 minutes called Pasta');
    expect(timerCards(result.cards)[0]?.label).toBe('Pasta');
  });

  it('runs several timers at the same time', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 10 minutes');
    await execute(h, timerCommand, 'set a timer for 2 minutes for tea');
    await execute(h, timerCommand, 'set a timer for 1 hour');
    expect(h.timers.list().map((record) => record.label)).toEqual(['Tea', 'Timer', 'Timer']);
    expect(h.timers.list().map((record) => record.durationMs)).toEqual([
      2 * MINUTE,
      10 * MINUTE,
      HOUR,
    ]);
  });

  it('fires when the time is up', async () => {
    const h = createHarness();
    const fired: string[] = [];
    h.timers.onFire((record) => fired.push(`${record.label}:${record.state}`));
    await execute(h, timerCommand, 'set a timer for 1 second');
    h.clock.advance(1_000);
    expect(fired).toEqual(['Timer:done']);
    expect(h.timers.list()).toEqual([]);
  });

  it('allows exactly 24 hours but refuses more', async () => {
    const h = createHarness();
    const allowed = await execute(h, timerCommand, 'set a timer for 24 hours');
    expect(timerCards(allowed.cards)).toHaveLength(1);

    const refused = await execute(h, timerCommand, 'set a timer for 25 hours');
    const card = refused.cards[0] as StatusCard;
    expect(card).toMatchObject({
      kind: 'status',
      tone: 'warning',
      title: "That's too long for a timer",
    });
    expect(card.detail).toContain('reminder');
    expect(refused.speech).toBe('Timers can run for up to 24 hours.');
    expect(h.timers.list()).toHaveLength(1);
  });

  it('refuses a zero length timer', async () => {
    const h = createHarness();
    const result = await execute(h, timerCommand, 'set a timer for 0 minutes');
    expect(result.cards[0]).toMatchObject({ tone: 'warning', title: 'A timer needs some time' });
    expect(h.timers.list()).toEqual([]);
  });
});

describe('asking how long', () => {
  it('asks for the duration and accepts the answer on the next turn', async () => {
    const h = createHarness();
    const question = await execute(h, timerCommand, 'set a timer');
    expect(question.cards[0]).toMatchObject({
      tone: 'neutral',
      title: 'How long should the timer run?',
    });
    expect(question.pin).toBe(true);
    expect(question.context).toEqual({ awaiting: 'timer-duration' });
    expect(h.timers.list()).toEqual([]);

    const answer = await execute(h, timerCommand, 'ten minutes', [turnAfter(h, 'timer', question)]);
    expect(answer.speech).toBe('Timer set for 10 minutes');
    expect(h.timers.list()).toHaveLength(1);
  });

  it('remembers the label while waiting for the duration', async () => {
    const h = createHarness();
    const question = await execute(h, timerCommand, 'start a timer for pasta');
    expect(question.context).toEqual({ awaiting: 'timer-duration', label: 'Pasta' });
    const answer = await execute(h, timerCommand, 'for 12 minutes', [
      turnAfter(h, 'timer', question),
    ]);
    expect(timerCards(answer.cards)[0]?.label).toBe('Pasta');
  });

  it('only listens to the answer for a short while and only after its own question', async () => {
    const h = createHarness();
    const question = await execute(h, timerCommand, 'set a timer');
    const turn = turnAfter(h, 'timer', question);
    const input = normalizeInput('ten minutes');

    expect(timerCommand.match(input, h.parseContext([]))).toBeNull();
    expect(timerCommand.match(input, h.parseContext([{ ...turn, commandId: 'notes' }]))).toBeNull();
    h.clock.jump(3 * MINUTE);
    expect(timerCommand.match(input, h.parseContext([turn]))).toBeNull();
  });
});

describe('listing timers', () => {
  it('says so when nothing is running', async () => {
    const h = createHarness();
    const result = await execute(h, timerCommand, 'show my timers');
    expect(result.cards[0]).toMatchObject({ kind: 'status', title: 'No timers running' });
    expect(result.speech).toBe('You have no timers running.');
    expect(result.pin).toBeUndefined();
  });

  it('shows the time left on a single timer', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 5 minutes');
    h.clock.advance(28_000);

    const result = await execute(h, timerCommand, 'how much time is left on my timer');
    expect(result.speech).toBe('4 minutes 32 seconds left on your timer');
    expect(result.pin).toBe(true);
    expect(timerCards(result.cards)).toHaveLength(1);
    expect(timerCards(result.cards)[0]).toMatchObject({ timerId: 't1', state: 'running' });
  });

  it('names a labelled timer', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 10 minutes called pasta');
    const result = await execute(h, timerCommand, 'show my timers');
    expect(result.speech).toBe('Pasta has 10 minutes left');
  });

  it('shows one card per timer, soonest first', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 10 minutes');
    await execute(h, timerCommand, 'set a timer for 2 minutes');
    await execute(h, timerCommand, 'set a timer for 5 minutes');

    const result = await execute(h, timerCommand, 'list timers');
    expect(timerCards(result.cards).map((card) => card.durationMs)).toEqual([
      2 * MINUTE,
      5 * MINUTE,
      10 * MINUTE,
    ]);
    expect(result.speech).toBe('You have 3 timers running. The next one has 2 minutes left.');
  });

  it('only lists timers, not alarms or reminders', async () => {
    const h = createHarness();
    h.timers.schedule({ at: NOW.getTime() + HOUR, label: 'Alarm', type: 'alarm' });
    h.timers.schedule({ at: NOW.getTime() + HOUR, label: 'Call mom', type: 'reminder' });
    const result = await execute(h, timerCommand, 'show my timers');
    expect(result.cards[0]).toMatchObject({ title: 'No timers running' });
  });
});

describe('cancelling timers', () => {
  it('cancels the most recent timer', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 5 minutes');
    h.clock.advance(1_000);
    await execute(h, timerCommand, 'set a timer for 10 minutes');

    const result = await execute(h, timerCommand, 'cancel my timer');
    expect(result.speech).toBe('Timer cancelled');
    expect(result.autoCloseMs).toBe(2500);
    expect(result.cards[0]).toMatchObject({ kind: 'timer', timerId: 't2', state: 'cancelled' });
    expect(h.timers.list().map((record) => record.id)).toEqual(['t1']);
  });

  it('cancels all timers but leaves alarms and reminders alone', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 5 minutes');
    await execute(h, timerCommand, 'set a timer for 10 minutes');
    h.timers.schedule({ at: NOW.getTime() + HOUR, label: 'Alarm', type: 'alarm' });
    h.timers.schedule({ at: NOW.getTime() + HOUR, label: 'Call mom', type: 'reminder' });

    const result = await execute(h, timerCommand, 'cancel all timers');
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      title: 'Cancelled 2 timers',
    });
    expect(result.speech).toBe('All 2 timers cancelled');
    expect(h.timers.list().map((record) => record.type)).toEqual(['alarm', 'reminder']);
  });

  it('phrases the result for a single timer that was cancelled with "all"', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 5 minutes');
    const result = await execute(h, timerCommand, 'stop all timers');
    expect(result.cards[0]).toMatchObject({ title: 'Cancelled your timer' });
    expect(result.speech).toBe('Timer cancelled');
  });

  it('cancels the timer a label or a length points to', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 10 minutes called pasta');
    await execute(h, timerCommand, 'set a timer for 3 minutes called tea');
    await execute(h, timerCommand, 'set a timer for 7 minutes');

    await execute(h, timerCommand, 'cancel the pasta timer');
    expect(h.timers.list().map((record) => record.label)).toEqual(['Tea', 'Timer']);
    await execute(h, timerCommand, 'cancel the 7 minute timer');
    expect(h.timers.list().map((record) => record.label)).toEqual(['Tea']);
  });

  it('explains when it cannot find the timer', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 3 minutes called tea');
    const result = await execute(h, timerCommand, 'cancel the coffee timer');
    expect(result.cards[0]).toMatchObject({
      tone: 'warning',
      title: "I couldn't find that timer",
      detail: 'You have: Tea (3:00 left).',
    });
    expect(h.timers.list()).toHaveLength(1);
  });

  it('is friendly when there is nothing to cancel', async () => {
    const h = createHarness();
    const result = await execute(h, timerCommand, 'cancel my timer');
    expect(result.cards[0]).toMatchObject({
      tone: 'neutral',
      title: 'No timers running',
      detail: 'There is nothing to cancel.',
    });
    expect(result.speech).toBe("You don't have any timers to cancel.");
  });

  it('does not find a timer that already finished', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 1 minute');
    h.clock.advance(MINUTE);
    const result = await execute(h, timerCommand, 'stop the timer');
    expect(result.cards[0]).toMatchObject({ title: 'No timers running' });
  });

  it('reports a timer that finished while it was being cancelled', async () => {
    const h = createHarness();
    await execute(h, timerCommand, 'set a timer for 1 minute');
    vi.spyOn(h.timers, 'cancel').mockReturnValue(false);
    const result = await execute(h, timerCommand, 'cancel my timer');
    expect(result.cards[0]).toMatchObject({ tone: 'neutral', title: 'That timer just finished' });
    expect(result.speech).toBe('That timer just finished.');
  });
});

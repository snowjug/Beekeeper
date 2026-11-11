import { describe, expect, it } from 'vitest';
import type { StatusCard, TimerCard } from '@shared/cards';
import { alarmCommand } from '@main/commands/productivity/alarm';
import { normalizeInput } from '@main/commands/text';
import { NOW, createHarness, execute, turnAfter } from './fakes';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function statusOf(card: unknown): StatusCard {
  return card as StatusCard;
}

describe('setting an alarm', () => {
  it('sets a morning alarm for the next day and confirms it', async () => {
    const h = createHarness();
    const result = await execute(h, alarmCommand, 'set an alarm for 7 am');

    expect(result.speech).toBe('Alarm set for tomorrow at 7:00 AM');
    expect(result.autoCloseMs).toBe(3500);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'alarm',
      title: 'Alarm set for tomorrow at 7:00 AM',
      detail: 'In 14 hours 37 minutes 24 seconds',
    });
    expect(h.timers.list()).toEqual([
      {
        id: 't1',
        type: 'alarm',
        label: 'Alarm',
        durationMs: new Date(2026, 10, 11, 7).getTime() - NOW.getTime(),
        startedAt: NOW.getTime(),
        endsAt: new Date(2026, 10, 11, 7).getTime(),
        state: 'running',
      },
    ]);
  });

  it('words a same-day alarm without the day', async () => {
    const h = createHarness();
    const result = await execute(h, alarmCommand, 'alarm for 7:30 pm');
    expect(result.speech).toBe('Alarm set for 7:30 PM');
    expect(statusOf(result.cards[0]).detail).toBe('In 3 hours 7 minutes 24 seconds');
  });

  it('reads an unmarked hour as morning', async () => {
    const h = createHarness();
    await execute(h, alarmCommand, 'wake me up at 6:30');
    expect(h.timers.list()[0]?.endsAt).toBe(new Date(2026, 10, 11, 6, 30).getTime());
  });

  it('rings when it is due', async () => {
    const h = createHarness();
    const fired: string[] = [];
    h.timers.onFire((record) => fired.push(record.type));
    await execute(h, alarmCommand, 'set an alarm in 10 minutes');
    h.clock.advance(10 * MINUTE);
    expect(fired).toEqual(['alarm']);
  });

  it('refuses a time that already passed today', async () => {
    const h = createHarness();
    const result = await execute(h, alarmCommand, 'set an alarm for today at 7 am');
    expect(statusOf(result.cards[0])).toMatchObject({
      tone: 'warning',
      title: 'That time has already passed',
    });
    expect(h.timers.list()).toEqual([]);
  });

  it('refuses alarms more than a year away', async () => {
    const h = createHarness();
    const result = await execute(h, alarmCommand, 'set an alarm in 400 days');
    expect(statusOf(result.cards[0]).title).toBe("That's too far away");
    expect(h.timers.list()).toEqual([]);
  });

  it('rings once when a repeat was asked for and says so', async () => {
    const h = createHarness();
    const result = await execute(h, alarmCommand, 'set an alarm for 7 am every day');
    expect(statusOf(result.cards[0]).detail).toContain('Repeating alarms are not supported yet');
    expect(h.timers.list()).toHaveLength(1);
  });
});

describe('asking for the time', () => {
  it('asks and accepts a clock time or a duration as the answer', async () => {
    const h = createHarness();
    const question = await execute(h, alarmCommand, 'set an alarm');
    expect(statusOf(question.cards[0]).title).toBe('What time should I set the alarm for?');
    expect(question.pin).toBe(true);
    expect(question.context).toEqual({ awaiting: 'alarm-time' });
    const turn = turnAfter(h, 'alarm', question);

    const clock = await execute(h, alarmCommand, '7 am', [turn]);
    expect(clock.speech).toBe('Alarm set for tomorrow at 7:00 AM');
    const duration = await execute(h, alarmCommand, '10 minutes', [turn]);
    expect(duration.speech).toBe('Alarm set for 4:32 PM');
    expect(h.timers.list()).toHaveLength(2);
  });

  it('keeps the day it was given and takes a bare hour as the answer', async () => {
    const h = createHarness();
    const question = await execute(h, alarmCommand, 'set an alarm for tomorrow');
    expect(question.context).toEqual({ awaiting: 'alarm-time', day: 'tomorrow' });
    const answer = await execute(h, alarmCommand, '8', [turnAfter(h, 'alarm', question)]);
    expect(answer.speech).toBe('Alarm set for tomorrow at 8:00 AM');
  });

  it('ignores unrelated text after the question', async () => {
    const h = createHarness();
    const question = await execute(h, alarmCommand, 'wake me up');
    const turn = turnAfter(h, 'alarm', question);
    expect(alarmCommand.match(normalizeInput('banana'), h.parseContext([turn]))).toBeNull();
    expect(alarmCommand.match(normalizeInput('7 am'), h.parseContext([]))).toBeNull();
  });
});

describe('listing and cancelling alarms', () => {
  async function twoAlarms() {
    const h = createHarness();
    await execute(h, alarmCommand, 'set an alarm for 7 am');
    await execute(h, alarmCommand, 'set an alarm for 8 am');
    return h;
  }

  it('lists alarms soonest first', async () => {
    const h = await twoAlarms();
    await execute(h, alarmCommand, 'alarm for 7:30 pm');
    const result = await execute(h, alarmCommand, 'show my alarms');
    const cards = result.cards as TimerCard[];
    expect(cards.map((card) => card.timerType)).toEqual(['alarm', 'alarm', 'alarm']);
    expect(cards.map((card) => card.endsAt)).toEqual([
      new Date(2026, 10, 10, 19, 30).getTime(),
      new Date(2026, 10, 11, 7).getTime(),
      new Date(2026, 10, 11, 8).getTime(),
    ]);
    expect(result.speech).toBe('You have 3 alarms set. The next one is at 7:30 PM.');
  });

  it('describes one alarm and none', async () => {
    const h = createHarness();
    const none = await execute(h, alarmCommand, 'what alarms do i have');
    expect(statusOf(none.cards[0]).title).toBe('No alarms set');
    expect(none.speech).toBe("You don't have any alarms set.");

    await execute(h, alarmCommand, 'set an alarm for 7 am');
    const one = await execute(h, alarmCommand, 'show my alarms');
    expect(one.speech).toBe('Your alarm is set for tomorrow at 7:00 AM');
  });

  it('cancels the alarm that rings at the named time', async () => {
    const h = await twoAlarms();
    const result = await execute(h, alarmCommand, 'cancel my 7 am alarm');
    expect(result.speech).toBe('Alarm cancelled');
    expect(h.timers.list().map((record) => record.endsAt)).toEqual([
      new Date(2026, 10, 11, 8).getTime(),
    ]);
  });

  it('cancels the most recent alarm, or all of them', async () => {
    const h = await twoAlarms();
    await execute(h, alarmCommand, 'cancel my alarm');
    expect(h.timers.list().map((record) => record.endsAt)).toEqual([
      new Date(2026, 10, 11, 7).getTime(),
    ]);
    await execute(h, alarmCommand, 'set an alarm for 9 am');
    const all = await execute(h, alarmCommand, 'delete all alarms');
    expect(statusOf(all.cards[0]).title).toBe('Cancelled 2 alarms');
    expect(h.timers.list()).toEqual([]);
  });

  it('does not delete alarms when told to stop one that is ringing', () => {
    const h = createHarness();
    expect(alarmCommand.match(normalizeInput('stop the alarm'), h.parseContext())).toBeNull();
  });

  it('leaves timers and reminders alone', async () => {
    const h = await twoAlarms();
    h.timers.startTimer({ durationMs: 5 * MINUTE });
    h.timers.schedule({ at: NOW.getTime() + HOUR, label: 'Call mom', type: 'reminder' });
    await execute(h, alarmCommand, 'cancel all alarms');
    expect(h.timers.list().map((record) => record.type)).toEqual(['timer', 'reminder']);
  });
});

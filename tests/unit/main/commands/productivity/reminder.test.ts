import { describe, expect, it } from 'vitest';
import type { StatusCard, TimerCard } from '@shared/cards';
import { reminderCommand } from '@main/commands/productivity/reminder';
import { normalizeInput } from '@main/commands/text';
import { createTimersService } from '@main/services/timers';
import { FakeClock, NOW, createHarness, execute, turnAfter } from './fakes';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function statusOf(card: unknown): StatusCard {
  return card as StatusCard;
}

describe('setting a reminder', () => {
  it('confirms a relative reminder and schedules it', async () => {
    const h = createHarness();
    const result = await execute(h, reminderCommand, 'remind me in 10 minutes to call mom');

    const sentence = "I'll remind you at 4:32 PM to call mom";
    expect(result.speech).toBe(sentence);
    expect(result.autoCloseMs).toBe(3000);
    expect(result.pin).toBeUndefined();
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'bell',
      title: sentence,
      detail: 'In 10 minutes',
    });
    expect(h.timers.list()).toEqual([
      {
        id: 't1',
        type: 'reminder',
        label: 'Call mom',
        durationMs: 10 * MINUTE,
        startedAt: NOW.getTime(),
        endsAt: NOW.getTime() + 10 * MINUTE,
        state: 'running',
      },
    ]);
  });

  it('confirms a clock time on the next day', async () => {
    const h = createHarness();
    const result = await execute(h, reminderCommand, 'remind me tomorrow at 9am to email john');
    expect(result.speech).toBe("I'll remind you tomorrow at 9:00 AM to email john");
    expect(statusOf(result.cards[0]).detail).toBe('In 16 hours 37 minutes 24 seconds');
    expect(h.timers.list()[0]?.endsAt).toBe(new Date(2026, 10, 11, 9).getTime());
  });

  it('uses the same words for a task and for a topic', async () => {
    const h = createHarness();
    const about = await execute(h, reminderCommand, 'remind me about the meeting in 15 minutes');
    expect(about.speech).toBe("I'll remind you at 4:37 PM about the meeting");
    const that = await execute(h, reminderCommand, 'remind me that the meeting is at 5pm');
    expect(that.speech).toBe("I'll remind you at 5:00 PM that the meeting");
    expect(h.timers.list().map((record) => record.label)).toEqual(['The meeting', 'The meeting']);
  });

  it('keeps names and capitals the user typed', async () => {
    const h = createHarness();
    const result = await execute(h, reminderCommand, 'Remind me to call John Smith at 5pm');
    expect(result.speech).toBe("I'll remind you at 5:00 PM to call John Smith");
    expect(h.timers.list()[0]?.label).toBe('Call John Smith');
  });

  it('says one-time when the user asked for a repeating reminder', async () => {
    const h = createHarness();
    const result = await execute(h, reminderCommand, 'remind me every day at 9am to take vitamins');
    expect(statusOf(result.cards[0]).detail).toContain(
      'I can only set one-time reminders for now.',
    );
    expect(h.timers.list()).toHaveLength(1);
    expect(h.timers.list()[0]?.label).toBe('Take vitamins');
  });

  it.each([
    'remind me every other day at 9am to water the plants',
    'remind me daily at 9am to water the plants',
    'remind me each morning at 9am to water the plants',
    'remind me every friday at 9am to water the plants',
  ])('also recognises the repeat in %j', async (phrase) => {
    const h = createHarness();
    const result = await execute(h, reminderCommand, phrase);
    expect(statusOf(result.cards[0]).detail).toContain('one-time');
    expect(h.timers.list()[0]?.label).toBe('Water the plants');
  });

  it('refuses a time that already passed today', async () => {
    const h = createHarness();
    const result = await execute(h, reminderCommand, 'remind me today at 7am to call mom');
    expect(statusOf(result.cards[0])).toMatchObject({
      tone: 'warning',
      title: 'That time has already passed',
    });
    expect(h.timers.list()).toEqual([]);
  });

  it('refuses reminders more than a year away but allows long ones', async () => {
    const h = createHarness();
    const far = await execute(h, reminderCommand, 'remind me in 400 days to renew the passport');
    expect(statusOf(far.cards[0]).title).toBe("That's too far away");
    expect(h.timers.list()).toEqual([]);

    await execute(h, reminderCommand, 'remind me in 300 days to renew the passport');
    expect(h.timers.list()).toHaveLength(1);
    expect(h.clock.longestDelay).toBeLessThanOrEqual(2_147_483_647);
  });

  it('fires the reminder when it is due', async () => {
    const h = createHarness();
    const fired: string[] = [];
    h.timers.onFire((record, info) => fired.push(`${record.type}:${record.label}:${info.missed}`));
    await execute(h, reminderCommand, 'remind me in 10 minutes to call mom');
    h.clock.advance(10 * MINUTE);
    expect(fired).toEqual(['reminder:Call mom:false']);
  });

  it('is still delivered after a restart', async () => {
    const h = createHarness();
    await execute(h, reminderCommand, 'remind me in 10 minutes to call mom');
    await execute(h, reminderCommand, 'remind me in 3 hours to stretch');

    const clock = new FakeClock(NOW.getTime() + 20 * MINUTE);
    const restarted = createTimersService({
      store: h.timersStore,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const fired: Array<[string, boolean]> = [];
    restarted.onFire((record, info) => fired.push([record.label, info.missed]));
    restarted.start();

    expect(fired).toEqual([['Call mom', true]]);
    clock.advance(3 * HOUR);
    expect(fired).toEqual([
      ['Call mom', true],
      ['Stretch', false],
    ]);
  });
});

describe('incomplete reminders', () => {
  it('asks what to remind about, then for the time', async () => {
    const h = createHarness();
    const first = await execute(h, reminderCommand, 'remind me');
    expect(statusOf(first.cards[0])).toMatchObject({
      tone: 'neutral',
      title: 'What should I remind you about?',
    });
    expect(first.pin).toBe(true);
    expect(first.context).toEqual({ awaiting: 'reminder-text', at: null });

    const second = await execute(h, reminderCommand, 'to call mom', [
      turnAfter(h, 'reminder', first),
    ]);
    expect(statusOf(second.cards[0]).title).toBe('When should I remind you?');
    expect(second.context).toEqual({ awaiting: 'reminder-time', text: 'call mom' });

    const done = await execute(h, reminderCommand, 'at 5pm', [turnAfter(h, 'reminder', second)]);
    expect(done.speech).toBe("I'll remind you at 5:00 PM to call mom");
    expect(h.timers.list()).toHaveLength(1);
  });

  it('keeps the time it was given while asking for the text', async () => {
    const h = createHarness();
    const question = await execute(h, reminderCommand, 'remind me in 5 minutes');
    expect(question.context).toEqual({
      awaiting: 'reminder-text',
      at: NOW.getTime() + 5 * MINUTE,
    });
    h.clock.advance(MINUTE);
    const done = await execute(h, reminderCommand, 'call mom', [
      turnAfter(h, 'reminder', question),
    ]);
    expect(done.speech).toBe("I'll remind you at 4:27 PM to call mom");
  });

  it('remembers "tomorrow" while it asks for the time', async () => {
    const h = createHarness();
    const question = await execute(h, reminderCommand, 'remind me tomorrow to call mom');
    expect(statusOf(question.cards[0]).title).toBe('When should I remind you?');
    expect(question.context).toEqual({
      awaiting: 'reminder-time',
      text: 'call mom',
      day: 'tomorrow',
    });

    const turn = turnAfter(h, 'reminder', question);
    const done = await execute(h, reminderCommand, 'at 9am', [turn]);
    expect(done.speech).toBe("I'll remind you tomorrow at 9:00 AM to call mom");
    const bare = await execute(h, reminderCommand, '8', [turn]);
    expect(bare.speech).toBe("I'll remind you tomorrow at 8:00 AM to call mom");
  });

  it('keeps the day while asking what to remind about, then for the time', async () => {
    const h = createHarness();
    const first = await execute(h, reminderCommand, 'remind me tomorrow');
    expect(first.context).toEqual({ awaiting: 'reminder-text', at: null, day: 'tomorrow' });

    const second = await execute(h, reminderCommand, 'email john', [
      turnAfter(h, 'reminder', first),
    ]);
    expect(second.context).toEqual({
      awaiting: 'reminder-time',
      text: 'email john',
      day: 'tomorrow',
    });
    const done = await execute(h, reminderCommand, '9am', [turnAfter(h, 'reminder', second)]);
    expect(done.speech).toBe("I'll remind you tomorrow at 9:00 AM to email john");
  });

  it('accepts a bare duration as the time', async () => {
    const h = createHarness();
    const question = await execute(h, reminderCommand, 'remind me to call mom');
    const done = await execute(h, reminderCommand, '10 minutes', [
      turnAfter(h, 'reminder', question),
    ]);
    expect(done.speech).toBe("I'll remind you at 4:32 PM to call mom");
  });

  it('ignores answers when it did not ask', () => {
    const h = createHarness();
    const input = normalizeInput('call mom');
    expect(reminderCommand.match(input, h.parseContext([]))).toBeNull();
    expect(
      reminderCommand.match(
        input,
        h.parseContext([
          {
            id: 'turn',
            at: NOW.getTime(),
            text: 'x',
            commandId: 'reminder',
            context: { awaiting: 'reminder-text', at: null },
          },
        ]),
      ),
    ).not.toBeNull();
    expect(
      reminderCommand.match(
        normalizeInput('whenever'),
        h.parseContext([
          {
            id: 'turn',
            at: NOW.getTime(),
            text: 'x',
            commandId: 'reminder',
            context: { awaiting: 'reminder-time', text: 'call mom' },
          },
        ]),
      ),
    ).toBeNull();
  });
});

describe('listing and cancelling reminders', () => {
  async function twoReminders() {
    const h = createHarness();
    await execute(h, reminderCommand, 'remind me in 10 minutes to call mom');
    await execute(h, reminderCommand, 'remind me tomorrow at 9am to email john');
    return h;
  }

  it('lists reminders soonest first', async () => {
    const h = await twoReminders();
    const result = await execute(h, reminderCommand, 'show my reminders');
    const cards = result.cards as TimerCard[];
    expect(cards.map((card) => [card.timerType, card.label])).toEqual([
      ['reminder', 'Call mom'],
      ['reminder', 'Email john'],
    ]);
    expect(result.speech).toBe('You have 2 reminders. The next one is at 4:32 PM: Call mom.');
    expect(result.pin).toBe(true);
  });

  it('describes a single reminder and the empty list', async () => {
    const h = createHarness();
    const empty = await execute(h, reminderCommand, 'show my reminders');
    expect(statusOf(empty.cards[0]).title).toBe('No reminders scheduled');
    expect(empty.speech).toBe("You don't have any reminders scheduled.");

    await execute(h, reminderCommand, 'remind me in 10 minutes to call mom');
    const one = await execute(h, reminderCommand, 'show my reminders');
    expect(one.speech).toBe('Reminder at 4:32 PM: Call mom');
  });

  it('cancels the latest, a named or every reminder', async () => {
    const h = await twoReminders();
    const latest = await execute(h, reminderCommand, 'cancel my reminder');
    expect(latest.speech).toBe('Reminder cancelled');
    expect(latest.cards[0]).toMatchObject({
      kind: 'timer',
      state: 'cancelled',
      label: 'Email john',
    });

    await execute(h, reminderCommand, 'remind me tomorrow at 9am to email john');
    await execute(h, reminderCommand, 'cancel the reminder to call mom');
    expect(h.timers.list().map((record) => record.label)).toEqual(['Email john']);

    const all = await execute(h, reminderCommand, 'delete all reminders');
    expect(all.speech).toBe('Reminder cancelled');
    expect(h.timers.list()).toEqual([]);
  });

  it('leaves timers and alarms alone', async () => {
    const h = await twoReminders();
    h.timers.startTimer({ durationMs: 5 * MINUTE });
    h.timers.schedule({ at: NOW.getTime() + DAY, label: 'Alarm', type: 'alarm' });
    await execute(h, reminderCommand, 'cancel all reminders');
    expect(h.timers.list().map((record) => record.type)).toEqual(['timer', 'alarm']);
  });
});

import { describe, expect, it } from 'vitest';
import type { StatusCard, TimeCard } from '@shared/cards';
import { dateTimeCommand } from '@main/commands/info/datetime';
import { matchOf, NOW, runContext } from '../helpers';

const slotsOf = (text: string) => matchOf(dateTimeCommand, text)?.slots;

describe('datetime: matching', () => {
  it.each([
    ['what time is it', { focus: 'time' }],
    ["What's the time?", { focus: 'time' }],
    ['whats the time', { focus: 'time' }],
    ['time', { focus: 'time' }],
    ['tell me the time', { focus: 'time' }],
    ['current time', { focus: 'time' }],
    ['what is the current time', { focus: 'time' }],
    ['what time is it now', { focus: 'time' }],
    ['do you know what time it is', { focus: 'time' }],
    ['Hey Beekeeper, what time is it please', { focus: 'time' }],
    ["what's the date", { focus: 'date' }],
    ["what is today's date", { focus: 'date' }],
    ["what's the date today", { focus: 'date' }],
    ['what date is it', { focus: 'date' }],
    ['date', { focus: 'date' }],
    ['what day is it', { focus: 'day' }],
    ['what day is it today', { focus: 'day' }],
    ['what day is today', { focus: 'day' }],
    ['which day is it', { focus: 'day' }],
    ['what day of the week is it', { focus: 'day' }],
    ["what's today", { focus: 'day' }],
  ])('%s', (text, slots) => {
    expect(matchOf(dateTimeCommand, text)).toEqual({ slots, score: 0.95 });
  });

  it.each([
    ['what time is it in Tokyo', { focus: 'time', place: 'tokyo' }],
    ['time in new york', { focus: 'time', place: 'new york' }],
    ["what's the time in London", { focus: 'time', place: 'london' }],
    ['what day is it in sydney', { focus: 'day', place: 'sydney' }],
    ["what's the date in tokyo", { focus: 'date', place: 'tokyo' }],
    ['what time is it in paris, france', { focus: 'time', place: 'paris, france' }],
  ])('names the place in %s', (text, slots) => {
    expect(slotsOf(text)).toEqual(slots);
  });

  it.each(['whats the tiem', 'what tiem is it', 'wat time is it', 'whats the dat'])(
    'repairs typos in %s with a lower score',
    (text) => {
      expect(matchOf(dateTimeCommand, text)).toMatchObject({ score: 0.8 });
    },
  );

  it('does not lower the score for a place that merely looks odd', () => {
    expect(matchOf(dateTimeCommand, 'what time is it in tokyo')?.score).toBe(0.95);
  });

  it.each([
    'timer',
    'set a timer for 5 minutes',
    'time for a break',
    'what time does the store open',
    'what is the tide',
    "what's the rate",
    'what day is it tomorrow',
    "what's the date tomorrow",
    'what time is it in',
    'what time is it in a minute',
    'what time is it in the morning',
    'what day is it in 2 weeks',
    'tiem',
    'weather',
    'open notepad',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(dateTimeCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(dateTimeCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of dateTimeCommand.examples) {
      expect(matchOf(dateTimeCommand, example), example).not.toBeNull();
    }
  });
});

describe('datetime: answers', () => {
  it('shows the local time', async () => {
    const ctx = runContext();
    const result = await dateTimeCommand.run({ focus: 'time' }, ctx);
    const card = result.cards[0] as TimeCard;
    expect(card).toMatchObject({
      kind: 'time',
      id: 'id-1',
      createdAt: NOW.getTime(),
      iso: NOW.toISOString(),
      timeText: '3:42 PM',
      dateText: 'Tuesday, November 10, 2026',
      weekday: 'Tuesday',
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      focus: 'time',
      copyText: '3:42 PM',
    });
    expect(result.speech).toBe("It's 3:42 PM.");
  });

  it('answers the date and the weekday', async () => {
    const date = await dateTimeCommand.run({ focus: 'date' }, runContext());
    expect(date.speech).toBe('Today is Tuesday, November 10, 2026.');
    expect((date.cards[0] as TimeCard).copyText).toBe('Tuesday, November 10, 2026');

    const day = await dateTimeCommand.run({ focus: 'day' }, runContext());
    expect(day.speech).toBe("It's Tuesday.");
    expect((day.cards[0] as TimeCard).focus).toBe('day');
  });

  describe('in another time zone', () => {
    const instant = new Date('2026-11-10T20:30:00Z');

    it('converts the instant', async () => {
      const result = await dateTimeCommand.run(
        { focus: 'time', place: 'tokyo' },
        runContext({ now: instant }),
      );
      expect(result.cards[0]).toMatchObject({
        zone: 'Asia/Tokyo',
        timeText: '5:30 AM',
        dateText: 'Wednesday, November 11, 2026',
        weekday: 'Wednesday',
        copyText: '5:30 AM in Tokyo',
      });
      expect(result.speech).toBe("It's 5:30 AM in Tokyo.");
    });

    it('knows the date and day may differ there', async () => {
      const date = await dateTimeCommand.run(
        { focus: 'date', place: 'Tokyo' },
        runContext({ now: instant }),
      );
      expect(date.speech).toBe("It's Wednesday, November 11, 2026 in Tokyo.");
      const day = await dateTimeCommand.run(
        { focus: 'day', place: 'new york' },
        runContext({ now: instant }),
      );
      expect(day.speech).toBe("It's Tuesday in New York.");
    });

    it('accepts countries and zone abbreviations', async () => {
      const uk = await dateTimeCommand.run(
        { focus: 'time', place: 'the uk' },
        runContext({ now: instant }),
      );
      expect(uk.speech).toBe("It's 8:30 PM in London.");
      const pst = await dateTimeCommand.run(
        { focus: 'time', place: 'pst' },
        runContext({ now: instant }),
      );
      expect(pst.speech).toBe("It's 12:30 PM in Pacific Time.");
    });
  });

  it('admits when it does not know the place and offers a web search', async () => {
    const result = await dateTimeCommand.run({ focus: 'time', place: 'atlantis' }, runContext());
    const card = result.cards[0] as StatusCard;
    expect(card).toMatchObject({
      kind: 'status',
      tone: 'warning',
      title: "I don't know the time zone for Atlantis",
    });
    expect(card.actions).toEqual([
      {
        type: 'url',
        label: 'Search the web',
        url: 'https://www.bing.com/search?q=time%20in%20atlantis',
      },
    ]);
    expect(result.speech).toBe("I don't know the time zone for Atlantis.");
  });
});

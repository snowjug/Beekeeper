import { describe, expect, it } from 'vitest';
import {
  findClockTime,
  findDuration,
  formatClock,
  formatDuration,
  formatRemaining,
  parseClockTime,
  parseDuration,
  type ClockTimeOptions,
} from '@main/commands/timeparse';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Tuesday 10 November 2026, 16:22:36 (local time). */
const NOW = new Date(2026, 10, 10, 16, 22, 36);

function local(month: number, day: number, hour: number, minute = 0, year = 2026): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('parseDuration', () => {
  it.each<[string, number]>([
    ['5 minutes', 5 * MINUTE],
    ['5 min', 5 * MINUTE],
    ['5 mins', 5 * MINUTE],
    ['1 minute', MINUTE],
    ['30 seconds', 30_000],
    ['90 secs', 90_000],
    ['an hour', HOUR],
    ['a minute', MINUTE],
    ['half an hour', 30 * MINUTE],
    ['half a minute', 30_000],
    ['half hour', 30 * MINUTE],
    ['a half hour', 30 * MINUTE],
    ['a quarter of an hour', 15 * MINUTE],
    ['quarter of an hour', 15 * MINUTE],
    ['1 hour 30 minutes', 90 * MINUTE],
    ['1 hour and 30 minutes', 90 * MINUTE],
    ['1 hour, 30 minutes', 90 * MINUTE],
    ['2 hours 15 minutes 30 seconds', 2 * HOUR + 15 * MINUTE + 30_000],
    ['1.5 hours', 90 * MINUTE],
    ['0.5 hours', 30 * MINUTE],
    ['two and a half minutes', 150_000],
    ['2 and a half hours', 150 * MINUTE],
    ['one and a half hours', 90 * MINUTE],
    ['an hour and a half', 90 * MINUTE],
    ['two hours and a half', 150 * MINUTE],
    ['ten minutes', 10 * MINUTE],
    ['twenty five minutes', 25 * MINUTE],
    ['one hundred twenty seconds', 120_000],
    ['a hundred seconds', 100_000],
    ['five', Number.NaN],
    ['5m', 5 * MINUTE],
    ['30s', 30_000],
    ['2h', 2 * HOUR],
    ['1h30m', 90 * MINUTE],
    ['10min', 10 * MINUTE],
    ['2hrs', 2 * HOUR],
    ['2 days', 48 * HOUR],
    ['a week', 7 * 24 * HOUR],
    ['for 5 minutes', 5 * MINUTE],
    ['in 10 minutes', 10 * MINUTE],
    ['5 minutes from now', 5 * MINUTE],
    ['10 minutes later', 10 * MINUTE],
    ['1 hour 30', 90 * MINUTE],
    ['an hour thirty', 90 * MINUTE],
    ['2 minutes 30', 150_000],
    ['5 minuts', 5 * MINUTE],
    ['5 secnds', 5_000],
    ['3 houres', 3 * HOUR],
    ['0 seconds', 0],
    ['  7   minutes ', 7 * MINUTE],
    ['5 MINUTES', 5 * MINUTE],
  ])('parses %j', (text, expected) => {
    if (Number.isNaN(expected)) expect(parseDuration(text)).toBeNull();
    else expect(parseDuration(text)).toBe(expected);
  });

  it.each([
    '',
    '5',
    'minutes',
    'banana',
    '5 minutes banana',
    '7 pm',
    '5 apples',
    'constructor minutes',
    '5 constructor',
    'a timer',
    'half past seven',
    '1 hour 70',
  ])('rejects %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });
});

describe('findDuration', () => {
  it('returns the token span so the duration can be cut out of a sentence', () => {
    expect(findDuration(['set', 'a', 'timer', 'for', '5', 'minutes'])).toEqual({
      ms: 5 * MINUTE,
      start: 4,
      end: 6,
    });
    expect(findDuration(['timer', 'for', '1', 'hour', '30', 'minutes', 'called', 'tea'])).toEqual({
      ms: 90 * MINUTE,
      start: 2,
      end: 6,
    });
    expect(findDuration(['in', 'half', 'an', 'hour', 'to', 'call'])).toEqual({
      ms: 30 * MINUTE,
      start: 1,
      end: 4,
    });
  });

  it('handles glued units and honours the start token', () => {
    expect(findDuration(['5min', 'timer'])).toEqual({ ms: 5 * MINUTE, start: 0, end: 1 });
    expect(findDuration(['5', 'minutes', 'then', '10', 'minutes'], 2)).toEqual({
      ms: 10 * MINUTE,
      start: 3,
      end: 5,
    });
  });

  it('returns null when there is no duration', () => {
    expect(findDuration(['no', 'duration', 'here'])).toBeNull();
    expect(findDuration([])).toBeNull();
    expect(findDuration(['5', 'pm'])).toBeNull();
  });
});

interface ClockCase {
  text: string;
  at: Date;
  hasDayWord?: boolean;
  options?: ClockTimeOptions;
}

describe('parseClockTime', () => {
  it.each<ClockCase>([
    { text: '7am', at: local(11, 11, 7) },
    { text: '7 am', at: local(11, 11, 7) },
    { text: '7AM', at: local(11, 11, 7) },
    { text: '7 a.m.', at: local(11, 11, 7) },
    { text: 'seven a m', at: local(11, 11, 7) },
    { text: '7:30 pm', at: local(11, 10, 19, 30) },
    { text: '7:30pm', at: local(11, 10, 19, 30) },
    { text: '7.30 pm', at: local(11, 10, 19, 30) },
    { text: '7 p.m.', at: local(11, 10, 19) },
    { text: '19:45', at: local(11, 10, 19, 45) },
    { text: '07:15', at: local(11, 11, 7, 15) },
    { text: '00:30', at: local(11, 11, 0, 30) },
    { text: '12:30', at: local(11, 11, 12, 30) },
    { text: '16:23', at: local(11, 10, 16, 23) },
    { text: '16:22', at: local(11, 11, 16, 22) },
    { text: '12 pm', at: local(11, 11, 12) },
    { text: '12 am', at: local(11, 11, 0) },
    { text: '12:30 am', at: local(11, 11, 0, 30) },
    { text: '12:15 pm', at: local(11, 11, 12, 15) },
    { text: 'noon', at: local(11, 11, 12) },
    { text: 'midday', at: local(11, 11, 12) },
    { text: '12 noon', at: local(11, 11, 12) },
    { text: 'midnight', at: local(11, 11, 0) },
    { text: '12 midnight', at: local(11, 11, 0) },
    { text: 'half past 7', at: local(11, 10, 19, 30) },
    { text: 'half past seven', at: local(11, 10, 19, 30) },
    { text: 'half past 7 am', at: local(11, 11, 7, 30) },
    { text: 'quarter to 9', at: local(11, 10, 20, 45) },
    { text: 'a quarter to nine', at: local(11, 10, 20, 45) },
    { text: 'quarter past 9', at: local(11, 10, 21, 15) },
    { text: 'quarter to 12', at: local(11, 10, 23, 45) },
    { text: 'ten to nine', at: local(11, 10, 20, 50) },
    { text: '10 to 9', at: local(11, 10, 20, 50) },
    { text: 'ten past three', at: local(11, 11, 15, 10) },
    { text: 'twenty to eight pm', at: local(11, 10, 19, 40) },
    { text: 'quarter past noon', at: local(11, 11, 12, 15) },
    { text: 'half past midnight', at: local(11, 11, 0, 30) },
    { text: "7 o'clock", at: local(11, 10, 19) },
    { text: 'seven oclock', at: local(11, 10, 19) },
    { text: '7 o clock', at: local(11, 10, 19) },
    { text: "7 o'clock am", at: local(11, 11, 7) },
    { text: "seven o'clock in the evening", at: local(11, 10, 19) },
    { text: 'seven thirty', at: local(11, 10, 19, 30) },
    { text: 'six forty five am', at: local(11, 11, 6, 45) },
    { text: 'six forty five a m', at: local(11, 11, 6, 45) },
    { text: 'three thirty p m', at: local(11, 11, 15, 30) },
    { text: 'half past seven a m', at: local(11, 11, 7, 30) },
    { text: "seven o'clock p m", at: local(11, 10, 19) },
    { text: 'twenty to eight p m', at: local(11, 10, 19, 40) },
    { text: 'seven oh five pm', at: local(11, 10, 19, 5) },
    { text: 'seven eleven', at: local(11, 10, 19, 11) },
    { text: '7 30 pm', at: local(11, 10, 19, 30) },
    { text: '7', at: local(11, 10, 19) },
    { text: '19', at: local(11, 10, 19) },
    { text: 'at 7', at: local(11, 10, 19) },
    { text: 'for 7 am', at: local(11, 11, 7) },
    { text: 'at noon', at: local(11, 11, 12) },
    { text: '3:30', at: local(11, 11, 15, 30) },
    { text: '9', at: local(11, 10, 21) },
    { text: '5 in the evening', at: local(11, 10, 17) },
    { text: '8 in the morning', at: local(11, 11, 8) },
    { text: '3 in the afternoon', at: local(11, 11, 15) },
    { text: '9 at night', at: local(11, 10, 21) },
    { text: '3 at night', at: local(11, 11, 3) },
    { text: '12 at night', at: local(11, 11, 0) },
    { text: 'tomorrow at 9am', at: local(11, 11, 9), hasDayWord: true },
    { text: 'tomorrow 9am', at: local(11, 11, 9), hasDayWord: true },
    { text: 'at 9am tomorrow', at: local(11, 11, 9), hasDayWord: true },
    { text: 'tomorrow at 8', at: local(11, 11, 8), hasDayWord: true },
    { text: 'tomorrow at 3', at: local(11, 11, 15), hasDayWord: true },
    { text: 'tomorrow at noon', at: local(11, 11, 12), hasDayWord: true },
    { text: 'tomorrow at midnight', at: local(11, 11, 0), hasDayWord: true },
    { text: 'tomorow at 9', at: local(11, 11, 9), hasDayWord: true },
    { text: 'tonigt at 8', at: local(11, 10, 20), hasDayWord: true },
    { text: 'tomorrow morning at 8', at: local(11, 11, 8), hasDayWord: true },
    { text: 'tomorrow evening at 7', at: local(11, 11, 19), hasDayWord: true },
    { text: 'today at 5pm', at: local(11, 10, 17), hasDayWord: true },
    { text: 'today at 5', at: local(11, 10, 17), hasDayWord: true },
    { text: 'today at 7am', at: local(11, 10, 7), hasDayWord: true },
    { text: '7 pm today', at: local(11, 10, 19), hasDayWord: true },
    { text: 'tonight at 8', at: local(11, 10, 20), hasDayWord: true },
    { text: 'tonight at 10', at: local(11, 10, 22), hasDayWord: true },
    { text: 'tonight at 12', at: local(11, 11, 0), hasDayWord: true },
    { text: 'tonight at 2', at: local(11, 11, 2), hasDayWord: true },
    { text: '8 tonight', at: local(11, 10, 20), hasDayWord: true },
    { text: 'this evening at 7', at: local(11, 10, 19), hasDayWord: true },
    { text: '7 this evening', at: local(11, 10, 19), hasDayWord: true },
    { text: 'this morning at 6', at: local(11, 10, 6), hasDayWord: true },
    { text: '6:30', options: { ambiguousHours: 'morning' }, at: local(11, 11, 6, 30) },
    { text: '8', options: { ambiguousHours: 'morning' }, at: local(11, 11, 8) },
    { text: 'at 12', options: { ambiguousHours: 'morning' }, at: local(11, 11, 12) },
    { text: '8 pm', options: { ambiguousHours: 'morning' }, at: local(11, 10, 20) },
    {
      text: 'tomorrow at 8',
      options: { ambiguousHours: 'morning' },
      at: local(11, 11, 8),
      hasDayWord: true,
    },
    { text: 'half past 6', options: { ambiguousHours: 'morning' }, at: local(11, 11, 6, 30) },
  ])('parses $text ($options)', ({ text, at, hasDayWord = false, options }) => {
    const result = parseClockTime(text, NOW, options);
    expect(result).not.toBeNull();
    expect(result?.at).toEqual(at);
    expect(result?.hasDayWord).toBe(hasDayWord);
  });

  it.each([
    '',
    '   ',
    'banana',
    'tomorrow',
    'at',
    '5 minutes',
    '13 pm',
    '0 am',
    '25:00',
    '7:75',
    '7 apples',
    '7.30',
    '0',
    '24',
    'at 99',
    'one to one',
    'noon banana',
  ])('rejects %j', (text) => {
    expect(parseClockTime(text, NOW)).toBeNull();
  });

  it('rolls over day, month and year boundaries', () => {
    expect(parseClockTime('midnight', new Date(2026, 10, 10, 23, 59, 30))?.at).toEqual(
      local(11, 11, 0),
    );
    expect(parseClockTime('7am', new Date(2026, 11, 31, 23, 30))?.at).toEqual(
      local(1, 1, 7, 0, 2027),
    );
    expect(parseClockTime('tomorrow at 9am', new Date(2028, 1, 28, 12))?.at).toEqual(
      local(2, 29, 9, 0, 2028),
    );
    expect(parseClockTime('tomorrow at 9am', new Date(2026, 11, 31, 12))?.at).toEqual(
      local(1, 1, 9, 0, 2027),
    );
  });

  it('treats the current minute as already passed', () => {
    expect(parseClockTime('7am', new Date(2026, 10, 10, 7, 0, 0, 0))?.at).toEqual(local(11, 11, 7));
    expect(parseClockTime('7am', new Date(2026, 10, 10, 6, 59, 59, 999))?.at).toEqual(
      local(11, 10, 7),
    );
  });

  it('never reads small hours for an unmarked hour unless asked to', () => {
    const lateNight = new Date(2026, 10, 10, 23, 30);
    expect(parseClockTime('at 3', lateNight)?.at).toEqual(local(11, 11, 15));
    expect(parseClockTime('at 3 am', lateNight)?.at).toEqual(local(11, 11, 3));
    expect(parseClockTime('at 6', lateNight)?.at).toEqual(local(11, 11, 6));
  });
});

describe('findClockTime', () => {
  const words = (text: string): string[] => text.split(' ');

  it.each<[string, number[], Date, boolean]>([
    ['at 3:30 pm to submit the report', [0, 1, 2], local(11, 11, 15, 30), false],
    ['to stretch at 5pm', [2, 3], local(11, 10, 17), false],
    ['tomorrow at 9am to email john', [0, 1, 2], local(11, 11, 9), true],
    ['to call mom tomorrow at 9', [3, 4, 5], local(11, 11, 9), true],
    ['tomorrow to call mom at 9am', [0, 4, 5], local(11, 11, 9), true],
    ['at 9am to call mom tomorrow', [0, 1, 5], local(11, 11, 9), true],
    ['to call mom at 9pm today', [3, 4, 5], local(11, 10, 21), true],
    ['for 6 pm to cook dinner', [0, 1, 2], local(11, 10, 18), false],
    ['for 6 to cook dinner', [0, 1], local(11, 10, 18), false],
    ['to buy a gift for 5 people at 6pm', [7, 8], local(11, 10, 18), false],
    ['about the one to one meeting at 5pm', [6, 7], local(11, 10, 17), false],
    ['to send it by tomorrow at 5', [3, 4, 5, 6], local(11, 11, 5 + 12), true],
    ['to catch the train at half past 7 tonight', [4, 5, 6, 7, 8], local(11, 10, 19, 30), true],
    ['at 7 in the evening to call', [0, 1, 2, 3, 4], local(11, 10, 19), false],
  ])('locates the time in %j', (text, consumed, at, hasDayWord) => {
    const match = findClockTime(words(text), NOW);
    expect(match).not.toBeNull();
    expect(match?.consumed).toEqual(consumed);
    expect(match?.hasDayWord).toBe(hasDayWord);
    expect(match?.at).toEqual(at);
  });

  it('ignores lone numbers that are not introduced by "at"', () => {
    expect(findClockTime(words('buy 2 apples'), NOW)).toBeNull();
    expect(findClockTime(words('to buy gifts for 5 people'), NOW)).toBeNull();
    expect(findClockTime(words('call mom'), NOW)).toBeNull();
    expect(findClockTime([], NOW)).toBeNull();
  });

  it('does not treat durations as clock times', () => {
    expect(findClockTime(words('in 5 minutes to call'), NOW)).toBeNull();
    expect(findClockTime(words('at 5 minutes past'), NOW)).toBeNull();
  });

  it('applies the morning preference for alarms', () => {
    const match = findClockTime(words('wake me up at 6:30'), NOW, { ambiguousHours: 'morning' });
    expect(match?.at).toEqual(local(11, 11, 6, 30));
    expect(match?.consumed).toEqual([3, 4]);
  });
});

describe('formatDuration', () => {
  it.each<[number, string]>([
    [5 * MINUTE, '5 minutes'],
    [MINUTE, '1 minute'],
    [90 * MINUTE, '1 hour 30 minutes'],
    [HOUR, '1 hour'],
    [2 * HOUR, '2 hours'],
    [45_000, '45 seconds'],
    [1_000, '1 second'],
    [90_000, '1 minute 30 seconds'],
    [HOUR + 2 * MINUTE + 3_000, '1 hour 2 minutes 3 seconds'],
    [24 * HOUR, '1 day'],
    [24 * HOUR + HOUR + MINUTE + 1_000, '1 day 1 hour 1 minute 1 second'],
    [500, '1 second'],
    [400, '0 seconds'],
    [0, '0 seconds'],
    [-5_000, '0 seconds'],
    [Number.NaN, '0 seconds'],
  ])('formats %d ms as %j', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('formatRemaining', () => {
  it.each<[number, string]>([
    [272_000, '4:32'],
    [271_500, '4:32'],
    [HOUR + 2 * MINUTE + 10_000, '1:02:10'],
    [0, '0:00'],
    [-10, '0:00'],
    [500, '0:01'],
    [59_000, '0:59'],
    [MINUTE, '1:00'],
    [HOUR, '1:00:00'],
    [24 * HOUR, '24:00:00'],
    [Number.NaN, '0:00'],
  ])('formats %d ms as %j', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});

describe('formatClock', () => {
  it.each<[Date, string]>([
    [local(11, 10, 15, 30), '3:30 PM'],
    [local(11, 10, 12, 0), '12:00 PM'],
    [local(11, 10, 17, 5), '5:05 PM'],
    [local(11, 11, 0, 5), 'tomorrow at 12:05 AM'],
    [local(11, 11, 9, 0), 'tomorrow at 9:00 AM'],
    [local(11, 11, 23, 59), 'tomorrow at 11:59 PM'],
    [local(11, 13, 9, 0), 'Friday at 9:00 AM'],
    [local(11, 16, 21, 15), 'Monday at 9:15 PM'],
    [local(11, 17, 9, 0), 'Nov 17 at 9:00 AM'],
    [local(1, 5, 9, 0, 2027), 'Jan 5, 2027 at 9:00 AM'],
    [local(11, 9, 17, 0), 'yesterday at 5:00 PM'],
    [local(11, 8, 17, 0), 'Nov 8 at 5:00 PM'],
  ])('formats %s as %j', (date, expected) => {
    expect(formatClock(date, NOW)).toBe(expected);
  });

  it('compares calendar days, not 24 hour windows', () => {
    const lateNight = new Date(2026, 10, 10, 23, 50);
    expect(formatClock(local(11, 11, 0, 10), lateNight)).toBe('tomorrow at 12:10 AM');
    expect(formatClock(local(11, 10, 23, 55), lateNight)).toBe('11:55 PM');
  });
});

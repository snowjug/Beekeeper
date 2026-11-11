import { describe, expect, it } from 'vitest';
import {
  categoryHindi,
  clockHindi,
  dateFromEnglish,
  degrees,
  durationFromEnglish,
  durationHindi,
  monthFromEnglish,
  parseTwelveHour,
  periodOf,
  quantityHindi,
  remainingHindi,
  unitHindi,
  weekdayFromEnglish,
  weekdayHindi,
  whenFromEnglish,
  whenHindi,
} from '@main/commands/hindi/localize/hi';

/** Tuesday, November 10 2026, 3:42 PM. */
const NOW = new Date(2026, 10, 10, 15, 42);
const at = (dayOffset: number, hour: number, minute = 0): Date =>
  new Date(2026, 10, 10 + dayOffset, hour, minute);

describe('time of day', () => {
  it.each([
    [0, 'रात'],
    [3, 'रात'],
    [4, 'सुबह'],
    [11, 'सुबह'],
    [12, 'दोपहर'],
    [15, 'दोपहर'],
    [16, 'शाम'],
    [18, 'शाम'],
    [19, 'रात'],
    [23, 'रात'],
  ])('hour %d is %s', (hour, period) => {
    expect(periodOf(hour)).toBe(period);
  });

  it.each([
    [7, 0, 'सुबह 7 बजे'],
    [15, 42, 'दोपहर 3:42 बजे'],
    [0, 5, 'रात 12:05 बजे'],
    [12, 0, 'दोपहर 12 बजे'],
    [18, 30, 'शाम 6:30 बजे'],
    [20, 0, 'रात 8 बजे'],
  ])('%d:%d is "%s"', (hour, minute, text) => {
    expect(clockHindi(hour, minute)).toBe(text);
  });

  it('reads a twelve-hour clock', () => {
    expect(parseTwelveHour('3:30 PM')).toEqual({ hour: 15, minute: 30 });
    expect(parseTwelveHour('12:00 AM')).toEqual({ hour: 0, minute: 0 });
    expect(parseTwelveHour('12:15 pm')).toEqual({ hour: 12, minute: 15 });
    expect(parseTwelveHour('quarter past')).toBeNull();
  });
});

describe('when something happens', () => {
  it.each([
    [at(0, 18), 'आज शाम 6 बजे'],
    [at(1, 7, 30), 'कल सुबह 7:30 बजे'],
    [at(-1, 9), 'बीते कल सुबह 9 बजे'],
    [at(3, 9), 'शुक्रवार को सुबह 9 बजे'],
    [at(10, 9), '20 नवंबर को सुबह 9 बजे'],
    [new Date(2027, 0, 5, 21), '5 जनवरी 2027 को रात 9 बजे'],
  ])('%s is "%s"', (date, text) => {
    expect(whenHindi(date, NOW)).toBe(text);
  });

  it.each([
    ['3:30 PM', 'आज दोपहर 3:30 बजे'],
    ['tomorrow at 9:00 AM', 'कल सुबह 9 बजे'],
    ['yesterday at 9:00 AM', 'बीते कल सुबह 9 बजे'],
    ['Friday at 9:00 AM', 'शुक्रवार को सुबह 9 बजे'],
    ['Nov 25 at 9:00 AM', '25 नवंबर को सुबह 9 बजे'],
    ['Nov 25, 2027 at 9:00 AM', '25 नवंबर 2027 को सुबह 9 बजे'],
  ])('the English clock "%s" is "%s"', (english, text) => {
    expect(whenFromEnglish(english)).toBe(text);
  });

  it('gives up on text that is not a clock', () => {
    expect(whenFromEnglish('whenever')).toBeNull();
    expect(whenFromEnglish('Someday at 9:00 AM')).toBeNull();
    expect(whenFromEnglish('Someday at 99:99 XM')).toBeNull();
  });
});

describe('days and months', () => {
  it('names weekdays and months', () => {
    expect(weekdayFromEnglish('Tuesday')).toBe('मंगलवार');
    expect(weekdayFromEnglish('Tue')).toBe('मंगलवार');
    expect(weekdayFromEnglish('tue', true)).toBe('मंगल');
    expect(weekdayFromEnglish('Blursday')).toBe('Blursday');
    expect(monthFromEnglish('November')).toBe('नवंबर');
    expect(monthFromEnglish('nov')).toBe('नवंबर');
    expect(monthFromEnglish('Smarch')).toBe('Smarch');
    expect(weekdayHindi(0)).toBe('रविवार');
    expect(weekdayHindi(-1)).toBe('शनिवार');
    expect(weekdayHindi(8)).toBe('सोमवार');
  });

  it('writes a long date', () => {
    expect(dateFromEnglish('Tuesday, November 10, 2026')).toBe('मंगलवार, 10 नवंबर 2026');
    expect(dateFromEnglish('some other text')).toBe('some other text');
  });
});

describe('durations and quantities', () => {
  it.each([
    ['1 hour 30 minutes', '1 घंटा 30 मिनट'],
    ['3 days and 4 hours', '3 दिन 4 घंटे'],
    ['2 hours', '2 घंटे'],
    ['45 seconds', '45 सेकंड'],
    ['less than a minute', 'एक मिनट से भी कम'],
    ['soon', 'soon'],
  ])('%s is "%s"', (english, text) => {
    expect(durationFromEnglish(english)).toBe(text);
  });

  it.each([
    [300_000, '5 मिनट'],
    [0, '0 सेकंड'],
    [Number.NaN, '0 सेकंड'],
    [90_000, '1 मिनट 30 सेकंड'],
    [3_600_000, '1 घंटा'],
    [5_400_000, '1 घंटा 30 मिनट'],
    [2 * 86_400_000 + 3_600_000, '2 दिन 1 घंटा'],
  ])('%d ms is "%s"', (ms, text) => {
    expect(durationHindi(ms)).toBe(text);
  });

  it('rounds a countdown up to whole seconds', () => {
    expect(remainingHindi(4_500)).toBe('5 सेकंड');
    expect(remainingHindi(-10)).toBe('0 सेकंड');
  });

  it('names units', () => {
    expect(quantityHindi('10 kilometers')).toBe('10 किलोमीटर');
    expect(quantityHindi('1 mile')).toBe('1 मील');
    expect(quantityHindi('5 nautical miles')).toBe('5 समुद्री मील');
    expect(quantityHindi('100°F')).toBe('100°F');
    expect(quantityHindi('7 widgets')).toBe('7 widgets');
    expect(unitHindi('kilometers')).toBe('किलोमीटर');
    expect(unitHindi('flux')).toBe('flux');
    expect(categoryHindi('length')).toBe('लंबाई');
    expect(categoryHindi('mood')).toBe('mood');
  });

  it('writes temperatures, with minus for the cold', () => {
    expect(degrees(21.6)).toBe('22');
    expect(degrees(-3.4)).toBe('माइनस 3');
  });
});

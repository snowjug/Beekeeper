import { describe, expect, it } from 'vitest';
import { extractDay, weekdayName, weekdayOfDate } from '@main/commands/lib/days';
import { NOW } from '../helpers';

// NOW is a Tuesday.
describe('extractDay', () => {
  it.each([
    ['weather tomorrow', 1, 'weather'],
    ["tomorrow's weather", 1, 'weather'],
    ['weather tomorrow morning', 1, 'weather'],
    ['weather tomorrow night', 1, 'weather'],
    ['weather the day after tomorrow evening', 2, 'weather'],
    ['weather saturday afternoon', 4, 'weather'],
    ['weather on friday night', 3, 'weather'],
    ['weather today', 0, 'weather'],
    ['weather tonight', 0, 'weather'],
    ['weather this evening', 0, 'weather'],
    ['weather in the morning', 0, 'weather'],
    ['weather the day after tomorrow', 2, 'weather'],
    ['weather day after tomorrow', 2, 'weather'],
    ['weather on saturday', 4, 'weather'],
    ['weather saturday', 4, 'weather'],
    ['weather this saturday', 4, 'weather'],
    ['weather on tuesday', 0, 'weather'],
    ['weather on monday', 6, 'weather'],
    ['weather next monday', 6, 'weather'],
    ['weather next wednesday', 1, 'weather'],
    ['weather on sundays', 5, 'weather'],
    ['weather this weekend', 4, 'weather'],
    ['weather for the weekend', 4, 'weather'],
    ['weather in 3 days', 3, 'weather'],
    ['weather in two days', 2, 'weather'],
    ['weather in 1 day', 1, 'weather'],
    ['weather in paris tomorrow', 1, 'weather in paris'],
    ['tomorrow in paris', 1, 'in paris'],
  ])('%s -> day %s', (text, day, rest) => {
    expect(extractDay(text, NOW)).toEqual({ day, unreachable: false, rest });
  });

  it('finds no day in a plain sentence', () => {
    expect(extractDay('weather in paris', NOW)).toEqual({
      unreachable: false,
      rest: 'weather in paris',
    });
  });

  it.each(['weather next tuesday', 'weather in 7 days', 'weather in 12 days'])(
    'flags %s as beyond the forecast',
    (text) => {
      expect(extractDay(text, NOW)).toMatchObject({ unreachable: true });
    },
  );

  it('measures weekdays from the given date', () => {
    const saturday = new Date(2026, 10, 14, 9, 0, 0);
    expect(extractDay('on saturday', saturday).day).toBe(0);
    expect(extractDay('this weekend', saturday).day).toBe(0);
    expect(extractDay('next saturday', saturday)).toMatchObject({ unreachable: true });
    const sunday = new Date(2026, 10, 15, 9, 0, 0);
    expect(extractDay('this weekend', sunday).day).toBe(0);
    expect(extractDay('on saturday', sunday).day).toBe(6);
  });
});

describe('weekday helpers', () => {
  it('reads the weekday of a calendar date', () => {
    expect(weekdayOfDate('2026-11-10')).toBe(2);
    expect(weekdayOfDate('2026-11-15')).toBe(0);
    expect(weekdayOfDate('2026-11-10T12:00')).toBe(2);
    expect(weekdayOfDate('soon')).toBeNull();
  });

  it('names weekdays', () => {
    expect(weekdayName('2026-11-14', 'long')).toBe('Saturday');
    expect(weekdayName('2026-11-14', 'short')).toBe('Sat');
    expect(weekdayName('nope', 'long')).toBe('');
  });
});

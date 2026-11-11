import { describe, expect, it } from 'vitest';
import { describeDuration } from '@main/commands/lib/durations';
import { findNumberSafe, formatValue } from '@main/commands/lib/numbers';
import { statusCard } from '@main/commands/lib/status';

describe('formatValue', () => {
  it.each([
    [360, '360'],
    [0, '0'],
    [-0, '0'],
    [6.666666666667, '6.666667'],
    [0.30000000000000004, '0.3'],
    [1234567.891, '1,234,567.891'],
    [-12.5, '-12.5'],
    [0.0000123, '0.0000123'],
    [0.000621371, '0.000621371'],
    [1e-7, '0.0000001'],
    [1.2246467991473532e-16, '1.224647e-16'],
    [1e-20, '1e-20'],
    [1e21, '1e21'],
    [2.5e15, '2.5e15'],
    [123456789012, '123,456,789,012'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
  ])('%s -> %s', (value, expected) => {
    expect(formatValue(value)).toBe(expected);
  });

  it('honours the requested number of decimals', () => {
    expect(formatValue(3.106855963, 4)).toBe('3.1069');
    expect(formatValue(0.000621371, 4)).toBe('0.0006214');
    expect(formatValue(2 / 3, 2)).toBe('0.67');
  });
});

describe('findNumberSafe', () => {
  it('reads numbers like findNumber', () => {
    expect(findNumberSafe(['twenty', 'five', 'km'])).toEqual({ value: 25, start: 0, end: 2 });
    expect(findNumberSafe(['go', '5'], 1)).toEqual({ value: 5, start: 1, end: 2 });
  });

  it('does not mistake Object.prototype names for numbers', () => {
    expect(findNumberSafe(['constructor'])).toBeNull();
    expect(findNumberSafe(['toString', 'valueOf', '__proto__', 'hasOwnProperty'])).toBeNull();
  });
});

describe('describeDuration', () => {
  it.each([
    [0, 'less than a minute'],
    [59, 'less than a minute'],
    [60, '1 minute'],
    [45 * 60, '45 minutes'],
    [3600, '1 hour'],
    [3600 + 5 * 60, '1 hour and 5 minutes'],
    [2 * 86_400, '2 days'],
    [3 * 86_400 + 4 * 3600 + 30 * 60, '3 days and 4 hours'],
    [-5, 'less than a minute'],
  ])('%s s -> %s', (seconds, expected) => {
    expect(describeDuration(seconds)).toBe(expected);
  });

  it('can name every unit', () => {
    expect(describeDuration(86_400 + 3600 + 60, 3)).toBe('1 day and 1 hour and 1 minute');
    expect(describeDuration(86_400 + 3600 + 60, 1)).toBe('1 day');
  });
});

describe('statusCard', () => {
  it('stamps an id and a creation time', () => {
    const card = statusCard(
      { now: new Date(1000), newId: () => 'abc' },
      { tone: 'warning', icon: 'clock', title: 'Hi', detail: 'There' },
    );
    expect(card).toEqual({
      kind: 'status',
      id: 'abc',
      createdAt: 1000,
      tone: 'warning',
      icon: 'clock',
      title: 'Hi',
      detail: 'There',
    });
  });
});

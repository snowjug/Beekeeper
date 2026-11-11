import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTimeZone, systemTimeZone } from '@main/commands/lib/timezones';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveTimeZone', () => {
  it.each([
    ['tokyo', 'Asia/Tokyo', 'Tokyo'],
    ['Tokyo', 'Asia/Tokyo', 'Tokyo'],
    ['new york', 'America/New_York', 'New York'],
    ['NYC', 'America/New_York', 'New York'],
    ['london', 'Europe/London', 'London'],
    ['the uk', 'Europe/London', 'London'],
    ['paris, france', 'Europe/Paris', 'Paris'],
    ['tokyo time', 'Asia/Tokyo', 'Tokyo'],
    ['São Paulo', 'America/Sao_Paulo', 'São Paulo'],
    ['sao paulo', 'America/Sao_Paulo', 'São Paulo'],
    ['washington d.c.', 'America/New_York', 'Washington'],
    ['l.a.', 'America/Los_Angeles', 'Los Angeles'],
    ['pst', 'America/Los_Angeles', 'Pacific Time'],
    ['est', 'America/New_York', 'Eastern Time'],
    ['ist', 'Asia/Kolkata', 'India Standard Time'],
    ['india', 'Asia/Kolkata', 'India'],
    ['sydney', 'Australia/Sydney', 'Sydney'],
    ['dubai', 'Asia/Dubai', 'Dubai'],
    ['utc', 'UTC', 'UTC'],
    ['gmt', 'UTC', 'UTC'],
    ['new zealand', 'Pacific/Auckland', 'Auckland'],
    ['  Berlin  ', 'Europe/Berlin', 'Berlin'],
  ])('%s -> %s', (place, zone, label) => {
    expect(resolveTimeZone(place)).toEqual({ zone, label });
  });

  it.each(['', 'atlantis', 'a break', 'the morning', 'usa'])('does not know %j', (place) => {
    expect(resolveTimeZone(place)).toBeNull();
  });

  it('only uses zones the runtime knows', () => {
    const source = readFileSync(resolve('src/main/commands/lib/timezones.ts'), 'utf8');
    const zones = new Set(
      [...source.matchAll(/'((?:[A-Z][A-Za-z_]+\/)+[A-Za-z_]+|UTC)'/g)].map((m) => m[1] ?? ''),
    );
    expect(zones.size).toBeGreaterThan(60);
    for (const zone of zones) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }), zone).not.toThrow();
    }
  });
});

describe('systemTimeZone', () => {
  it('returns the zone of this PC', () => {
    expect(systemTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('falls back to UTC when the runtime reports no zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: '' }) }) as Intl.DateTimeFormat,
    );
    expect(systemTimeZone()).toBe('UTC');
  });
});

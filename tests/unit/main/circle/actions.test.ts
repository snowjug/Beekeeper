import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createCircleActions,
  formatCalculation,
  reminderTimeFromIso,
  type CircleActionDeps,
} from '@main/circle/actions';

const NOW = new Date(2026, 10, 10, 12, 0, 0);

describe('reminderTimeFromIso', () => {
  it('uses the given local time', () => {
    expect(reminderTimeFromIso('2026-11-11T15:30', NOW)).toBe(
      new Date(2026, 10, 11, 15, 30).getTime(),
    );
  });

  it('defaults date-only reminders to 09:00', () => {
    expect(reminderTimeFromIso('2026-12-01', NOW)).toBe(new Date(2026, 11, 1, 9, 0).getTime());
  });

  it.each(['2026-11-10T11:59', '2020-01-01', 'tomorrow', '2026-02-31', ''])(
    'rejects %j (past, invalid or not a date)',
    (value) => {
      expect(reminderTimeFromIso(value, NOW)).toBeNull();
    },
  );
});

describe('formatCalculation', () => {
  it('groups thousands and trims float noise', () => {
    expect(formatCalculation(1234567.891)).toBe('1,234,567.891');
    expect(formatCalculation(0.1 + 0.2)).toBe('0.3');
  });
});

function deps(overrides: Partial<CircleActionDeps> = {}): CircleActionDeps {
  return {
    writeClipboardImage: vi.fn(() => Promise.resolve()),
    writeClipboardText: vi.fn(() => Promise.resolve()),
    openUrl: vi.fn(() => Promise.resolve()),
    writeFile: vi.fn(() => Promise.resolve()),
    ensureDir: vi.fn(),
    scheduleReminder: vi.fn(),
    picturesDir: join('C:\\Users\\me\\Pictures', 'Beekeeper'),
    now: () => NOW,
    ...overrides,
  };
}

describe('createCircleActions', () => {
  it('only opens http(s) and mailto links', async () => {
    const d = deps();
    const actions = createCircleActions(d);
    expect(await actions.openExternal('https://example.com/a?b=1')).toBe(true);
    expect(await actions.openExternal('mailto:me@example.com')).toBe(true);
    expect(await actions.openExternal('file:///C:/Windows/System32/calc.exe')).toBe(false);
    // eslint-disable-next-line no-script-url -- deliberately hostile input
    expect(await actions.openExternal('javascript:alert(1)')).toBe(false);
    expect(await actions.openExternal('ms-settings:privacy')).toBe(false);
    expect(d.openUrl).toHaveBeenCalledTimes(2);
  });

  it('reports a failing browser launch as false', async () => {
    const actions = createCircleActions(
      deps({ openUrl: vi.fn(() => Promise.reject(new Error('x'))) }),
    );
    expect(await actions.openExternal('https://example.com')).toBe(false);
  });

  it('saves PNGs into the Beekeeper pictures folder with a timestamped name', async () => {
    const d = deps();
    const path = await createCircleActions(d).savePng(Buffer.from('png'));
    expect(path).toBe(join(d.picturesDir, 'Circle-2026-11-10-12-00-00.png'));
    expect(d.ensureDir).toHaveBeenCalledWith(d.picturesDir);
    expect(d.writeFile).toHaveBeenCalledWith(path, Buffer.from('png'));
  });

  it('schedules reminders only for future dates and evaluates math safely', () => {
    const d = deps();
    const actions = createCircleActions(d);
    expect(actions.addReminder('2026-11-12T10:00', 'Pay rent')).toBe(true);
    expect(d.scheduleReminder).toHaveBeenCalledWith(
      new Date(2026, 10, 12, 10, 0).getTime(),
      'Pay rent',
    );
    expect(actions.addReminder('2020-01-01', 'old')).toBe(false);
    expect(actions.calculate('12 * (3 + 4)')).toBe('84');
    expect(actions.calculate('1 / 0')).toBeNull();
    expect(actions.calculate('process.exit(1)')).toBeNull();
  });
});

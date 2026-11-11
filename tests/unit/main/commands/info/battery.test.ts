import { describe, expect, it } from 'vitest';
import type { BatteryCard, StatusCard } from '@shared/cards';
import { batteryCommand } from '@main/commands/info/battery';
import type { BatteryInfo } from '@main/system/types';
import {
  createFakeLogger,
  createFakeServices,
  createFakeSystem,
  matchOf,
  runContext,
} from '../helpers';

const slotsOf = (text: string) => matchOf(batteryCommand, text)?.slots;

describe('battery: phrases', () => {
  it.each([
    ['battery status', 'level'],
    ['how much battery do I have', 'level'],
    ['battery level', 'level'],
    ['battery percentage', 'level'],
    ["how's my battery", 'level'],
    ["what's my battery at", 'level'],
    ['battery', 'level'],
    ['check battery', 'level'],
    ['how much charge is left', 'level'],
    ['how much power is left', 'level'],
    ['is my laptop charging', 'charging'],
    ['is my pc plugged in', 'charging'],
    ['am i charging', 'charging'],
    ['is it charging', 'charging'],
    ['Hey Beekeeper, is my battery charging please', 'charging'],
  ])('%s', (text, focus) => {
    expect(matchOf(batteryCommand, text)).toEqual({ slots: { focus }, score: 0.95 });
  });

  it('repairs typos with a lower score', () => {
    expect(matchOf(batteryCommand, 'batery status')).toEqual({
      slots: { focus: 'level' },
      score: 0.85,
    });
    expect(slotsOf('is my laptop chargin')).toEqual({ focus: 'charging' });
  });

  it.each([
    'battery saver',
    'turn on battery saver',
    'how long will my battery last',
    'charge my phone',
    'charging station near me',
    'power off',
    'power',
    'how much is left',
    'what time is it',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(batteryCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(batteryCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of batteryCommand.examples) {
      expect(matchOf(batteryCommand, example), example).not.toBeNull();
    }
  });
});

describe('battery: answers', () => {
  const run = async (info: BatteryInfo, focus: 'level' | 'charging' = 'level') => {
    const services = createFakeServices([], {
      system: createFakeSystem({ getBattery: () => Promise.resolve(info) }),
    });
    const result = await batteryCommand.run({ focus }, runContext({ services }));
    return { result, card: result.cards[0] as BatteryCard };
  };

  it('reports the level and the time left on battery power', async () => {
    const { result, card } = await run({
      hasBattery: true,
      percent: 62,
      charging: false,
      onAc: false,
      minutesRemaining: 190,
    });
    expect(card).toMatchObject({
      kind: 'battery',
      id: 'id-1',
      hasBattery: true,
      percent: 62,
      charging: false,
      onAc: false,
      minutesRemaining: 190,
      copyText: 'Battery: 62% (on battery)',
    });
    expect(result.speech).toBe('Your battery is at 62 percent, about 3 hours and 10 minutes left.');
  });

  it('says when it is charging or plugged in', async () => {
    const charging = await run({ hasBattery: true, percent: 80, charging: true, onAc: true });
    expect(charging.result.speech).toBe('Your battery is at 80 percent and charging.');
    expect(charging.card.copyText).toBe('Battery: 80% (charging)');

    const full = await run({ hasBattery: true, percent: 100, charging: false, onAc: true });
    expect(full.result.speech).toBe('Your battery is at 100 percent and plugged in.');
    expect(full.card.copyText).toBe('Battery: 100% (plugged in)');
  });

  it('leaves out an unknown or empty time estimate', async () => {
    const unknown = await run({ hasBattery: true, percent: 55, charging: false, onAc: false });
    expect(unknown.result.speech).toBe('Your battery is at 55 percent.');
    expect(unknown.card.minutesRemaining).toBeUndefined();
    const zero = await run({
      hasBattery: true,
      percent: 55,
      charging: false,
      onAc: false,
      minutesRemaining: 0,
    });
    expect(zero.result.speech).toBe('Your battery is at 55 percent.');
  });

  it('answers "is it charging" directly', async () => {
    const yes = await run(
      { hasBattery: true, percent: 80, charging: true, onAc: true },
      'charging',
    );
    expect(yes.result.speech).toBe("Yes, your battery is charging. It's at 80 percent.");
    const full = await run(
      { hasBattery: true, percent: 100, charging: false, onAc: true },
      'charging',
    );
    expect(full.result.speech).toBe(
      "No, it's plugged in but not charging. The battery is at 100 percent.",
    );
    const no = await run(
      { hasBattery: true, percent: 62, charging: false, onAc: false },
      'charging',
    );
    expect(no.result.speech).toBe('No, your PC is running on battery power at 62 percent.');
  });

  it('copes with a PC that has no battery', async () => {
    const { result, card } = await run({ hasBattery: false, charging: false, onAc: true });
    expect(card).toMatchObject({ hasBattery: false, onAc: true });
    expect(card.percent).toBeUndefined();
    expect(result.speech).toBe("This PC doesn't have a battery. It's running on AC power.");
  });

  it('shows a friendly error when Windows does not answer', async () => {
    const logger = createFakeLogger();
    const services = createFakeServices([], {
      system: createFakeSystem({ getBattery: () => Promise.reject(new Error('WMI timeout')) }),
    });
    const result = await batteryCommand.run({ focus: 'level' }, runContext({ services, logger }));
    expect(result.cards[0]).toMatchObject({ kind: 'status', tone: 'error', icon: 'battery' });
    expect((result.cards[0] as StatusCard).title).toBe("I couldn't read the battery status");
    expect(result.speech).toBe("Sorry, I couldn't read the battery status.");
    expect(logger.warn).toHaveBeenCalled();
  });
});

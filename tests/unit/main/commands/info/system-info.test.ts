import { describe, expect, it } from 'vitest';
import type { StatusCard, SystemInfoCard } from '@shared/cards';
import { systemInfoCommand } from '@main/commands/info/system-info';
import type { SystemInfoSlots } from '@main/commands/info/system-info';
import type { SystemInfoData } from '@main/system/types';
import {
  SAMPLE_SYSTEM_INFO,
  createFakeLogger,
  createFakeServices,
  createFakeSystem,
  matchOf,
  runContext,
} from '../helpers';

describe('system info: phrases', () => {
  it.each<[string, SystemInfoSlots['focus']]>([
    ['system info', 'overview'],
    ['system information', 'overview'],
    ['show system info', 'overview'],
    ["what's my system information", 'overview'],
    ['pc specs', 'overview'],
    ['what are my pc specs', 'overview'],
    ['my specs', 'overview'],
    ['about this pc', 'overview'],
    ['cpu and ram usage', 'overview'],
    ['how much ram do i have', 'ram'],
    ['how much memory do i have', 'ram'],
    ['memory usage', 'ram'],
    ['cpu usage', 'cpu'],
    ["what's my cpu", 'cpu'],
    ["how's my cpu doing", 'cpu'],
    ['how much disk space is left', 'disk'],
    ['how much storage do i have left', 'disk'],
    ['disk usage', 'disk'],
    ['how long has my pc been on', 'uptime'],
    ['how long has my computer been running', 'uptime'],
    ['uptime', 'uptime'],
    ['Hey Beekeeper, how much RAM do I have please', 'ram'],
  ])('%s', (text, focus) => {
    expect(matchOf(systemInfoCommand, text)).toEqual({ slots: { focus }, score: 0.95 });
  });

  it('repairs typos with a lower score', () => {
    expect(matchOf(systemInfoCommand, 'systm info')).toEqual({
      slots: { focus: 'overview' },
      score: 0.85,
    });
    expect(matchOf(systemInfoCommand, 'how much memry do i have')).toEqual({
      slots: { focus: 'ram' },
      score: 0.85,
    });
  });

  it.each([
    'system',
    'info',
    'free up disk space',
    'clear memory',
    'increase ram',
    'cpu temperature',
    'open task manager',
    'how long has the movie been on',
    'show me the weather',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(systemInfoCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(systemInfoCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of systemInfoCommand.examples) {
      expect(matchOf(systemInfoCommand, example), example).not.toBeNull();
    }
  });
});

describe('system info: answers', () => {
  const run = async (
    focus: SystemInfoSlots['focus'],
    data: SystemInfoData = SAMPLE_SYSTEM_INFO,
  ) => {
    const services = createFakeServices([], {
      system: createFakeSystem({ getSystemInfo: () => Promise.resolve(data) }),
    });
    const result = await systemInfoCommand.run({ focus }, runContext({ services }));
    return { result, card: result.cards[0] as SystemInfoCard };
  };

  it('always shows the full card with a copyable summary', async () => {
    const { card } = await run('ram');
    expect(card).toMatchObject({ kind: 'sysinfo', id: 'id-1', ...SAMPLE_SYSTEM_INFO });
    expect(card.copyText).toBe(
      [
        'OS: Windows 11 Pro',
        'CPU: Intel Core i7-1165G7 (8 cores), 12% in use',
        'Memory: 8 GB of 16 GB used (50%)',
        'Disk C:: 119.2 GB free of 475.9 GB',
        'Uptime: 3 days and 4 hours',
      ].join('\n'),
    );
  });

  it.each<[SystemInfoSlots['focus'], string]>([
    ['ram', "You're using 8 GB of 16 GB of memory, about 50 percent."],
    ['cpu', 'CPU usage is 12 percent on your 8-core Intel Core i7-1165G7.'],
    ['disk', 'You have 119.2 GB free on drive C:, out of 475.9 GB.'],
    ['uptime', 'Your PC has been on for 3 days and 4 hours.'],
    [
      'overview',
      'Windows 11 Pro. CPU at 12 percent, memory 50 percent used, 119.2 GB free on drive C:. Up for 3 days and 4 hours.',
    ],
  ])('speaks the %s answer', async (focus, speech) => {
    expect((await run(focus)).result.speech).toBe(speech);
  });

  it('picks sensible units for small and huge sizes', async () => {
    const data: SystemInfoData = {
      ...SAMPLE_SYSTEM_INFO,
      memory: { totalBytes: 2_147_483_648, usedBytes: 536_870_912, usagePercent: 25 },
      disk: {
        drive: 'D:',
        totalBytes: 2_000_000_000_000,
        freeBytes: 500_000_000_000,
        usagePercent: 75,
      },
    };
    expect((await run('ram', data)).result.speech).toBe(
      "You're using 512 MB of 2 GB of memory, about 25 percent.",
    );
    expect((await run('disk', data)).result.speech).toBe(
      'You have 465.7 GB free on drive D:, out of 1.8 TB.',
    );
  });

  it('shows a friendly error when Windows does not answer', async () => {
    const logger = createFakeLogger();
    const services = createFakeServices([], {
      system: createFakeSystem({ getSystemInfo: () => Promise.reject(new Error('WMI')) }),
    });
    const result = await systemInfoCommand.run({ focus: 'cpu' }, runContext({ services, logger }));
    expect((result.cards[0] as StatusCard).tone).toBe('error');
    expect(result.speech).toBe("Sorry, I couldn't read the system information.");
    expect(logger.warn).toHaveBeenCalled();
  });
});

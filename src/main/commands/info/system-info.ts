import type { CommandResult, SystemInfoCard } from '@shared/cards';
import type { SystemInfoData } from '../../system/types';
import { describeDuration } from '../lib/durations';
import { correctTokens } from '../lib/fuzzy';
import { formatValue } from '../lib/numbers';
import { statusCard } from '../lib/status';
import { matchPhrase } from '../text';
import { defineCommand } from '../types';
import type { RunContext } from '../types';

type Focus = 'overview' | 'ram' | 'cpu' | 'disk' | 'uptime';

export interface SystemInfoSlots {
  focus: Focus;
}

const OVERVIEW_PHRASES = [
  'system info',
  'system information',
  'system status',
  'system stats',
  'system specs',
  'system details',
  'system overview',
  'pc info',
  'pc information',
  'pc status',
  'pc specs',
  'pc stats',
  'pc details',
  'computer info',
  'computer information',
  'computer specs',
  'computer status',
  'laptop info',
  'laptop specs',
  'hardware info',
  'about this pc',
  'about my pc',
  'about this computer',
  'my specs',
  'specs',
];
const REQUEST_PREFIX =
  /^(?:(?:show|tell|give|get|check|display|pull up)\s+)*(?:me\s+)?(?:what(?:'s| is| are)?\s+)?(?:the\s+|my\s+)?/;

const VOCABULARY = ['memory', 'storage', 'processor', 'uptime', 'usage'];
const FOCUS_KEYWORDS: ReadonlyArray<readonly [Focus, readonly string[]]> = [
  ['ram', ['ram', 'memory']],
  ['cpu', ['cpu', 'processor']],
  ['disk', ['disk', 'storage', 'drive', 'ssd', 'hdd']],
  ['uptime', ['uptime']],
];
const UPTIME_PHRASE =
  /^how long (?:has|have|is|was) (?:my |the |this )?(?:pc|computer|laptop|machine|system|windows)? ?(?:been )?(?:on|up|running|powered on|turned on|awake)$/;
const ALLOWED = new Set([
  ...FOCUS_KEYWORDS.flatMap(([, words]) => words),
  'what',
  'how',
  'much',
  'many',
  'is',
  'are',
  'my',
  'the',
  'this',
  'do',
  'does',
  'i',
  'have',
  'left',
  'free',
  'available',
  'usage',
  'used',
  'using',
  'of',
  'current',
  'show',
  'tell',
  'me',
  'give',
  'get',
  'check',
  'total',
  'installed',
  'size',
  'space',
  'in',
  'use',
  'there',
  'it',
  'pc',
  'computer',
  'laptop',
  'machine',
  'system',
  'load',
  'doing',
  'and',
]);

function parse(text: string): { slots: SystemInfoSlots; corrected: boolean } | null {
  const request = text.replace(REQUEST_PREFIX, '');
  const overview = matchPhrase(request, OVERVIEW_PHRASES);
  if (overview !== null) {
    return { slots: { focus: 'overview' }, corrected: overview !== request };
  }

  const spaced = text.replace(/\b(what|how|it)'?s\b/g, '$1');
  if (UPTIME_PHRASE.test(spaced)) return { slots: { focus: 'uptime' }, corrected: false };

  const fixed = correctTokens(spaced.split(' '), VOCABULARY);
  if (!fixed.tokens.every((token) => ALLOWED.has(token))) return null;
  const focuses = FOCUS_KEYWORDS.filter(([, words]) =>
    fixed.tokens.some((token) => words.includes(token)),
  ).map(([focus]) => focus);
  if (focuses.length === 0) return null;
  return {
    slots: { focus: focuses.length === 1 ? (focuses[0] ?? 'overview') : 'overview' },
    corrected: fixed.corrected,
  };
}

function formatBytes(bytes: number): string {
  const gib = 1024 ** 3;
  if (bytes >= 1024 * gib) return `${formatValue(bytes / (1024 * gib), 1)} TB`;
  if (bytes >= gib) return `${formatValue(bytes / gib, 1)} GB`;
  return `${formatValue(bytes / 1024 ** 2, 0)} MB`;
}

function failure(ctx: RunContext): CommandResult {
  const card = statusCard(ctx, {
    tone: 'error',
    icon: 'cpu',
    title: "I couldn't read the system information",
    detail: 'Windows did not answer. Please try again.',
  });
  return { cards: [card], speech: "Sorry, I couldn't read the system information." };
}

function describe(data: SystemInfoData, focus: Focus): string {
  const { cpu, memory, disk } = data;
  const percent = (value: number): number => Math.round(value);
  switch (focus) {
    case 'ram':
      return `You're using ${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} of memory, about ${percent(memory.usagePercent)} percent.`;
    case 'cpu':
      return `CPU usage is ${percent(cpu.usagePercent)} percent on your ${cpu.cores}-core ${cpu.name}.`;
    case 'disk':
      return `You have ${formatBytes(disk.freeBytes)} free on drive ${disk.drive}, out of ${formatBytes(disk.totalBytes)}.`;
    case 'uptime':
      return `Your PC has been on for ${describeDuration(data.uptimeSeconds)}.`;
    case 'overview':
      return `${data.os}. CPU at ${percent(cpu.usagePercent)} percent, memory ${percent(memory.usagePercent)} percent used, ${formatBytes(disk.freeBytes)} free on drive ${disk.drive}. Up for ${describeDuration(data.uptimeSeconds)}.`;
  }
}

export const systemInfoCommand = defineCommand<SystemInfoSlots>({
  id: 'system-info',
  number: 9,
  group: 'info',
  title: 'System info',
  icon: 'cpu',
  examples: ['System info', 'How much RAM do I have?', 'How long has my PC been on?'],

  match(input) {
    const parsed = parse(input.text);
    return parsed ? { slots: parsed.slots, score: parsed.corrected ? 0.85 : 0.95 } : null;
  },

  async run(slots, ctx) {
    let data: SystemInfoData;
    try {
      data = await ctx.services.system.getSystemInfo();
    } catch (error) {
      ctx.logger.warn('Could not read the system information:', error);
      return failure(ctx);
    }

    const card: SystemInfoCard = {
      kind: 'sysinfo',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      ...data,
      copyText: [
        `OS: ${data.os}`,
        `CPU: ${data.cpu.name} (${data.cpu.cores} cores), ${Math.round(data.cpu.usagePercent)}% in use`,
        `Memory: ${formatBytes(data.memory.usedBytes)} of ${formatBytes(data.memory.totalBytes)} used (${Math.round(data.memory.usagePercent)}%)`,
        `Disk ${data.disk.drive}: ${formatBytes(data.disk.freeBytes)} free of ${formatBytes(data.disk.totalBytes)}`,
        `Uptime: ${describeDuration(data.uptimeSeconds)}`,
      ].join('\n'),
    };
    return { cards: [card], speech: describe(data, slots.focus) };
  },
});

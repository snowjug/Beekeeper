export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const LONG_NAMES = WEEKDAYS.map((name) => `${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`);

/** Day of the week (0 = Sunday) of a "YYYY-MM-DD" calendar date, or null when malformed. */
export function weekdayOfDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const [, year = '', month = '', day = ''] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
}

/** "Wednesday" or "Wed" for a "YYYY-MM-DD" date. Empty when the date is malformed. */
export function weekdayName(date: string, style: 'long' | 'short'): string {
  const index = weekdayOfDate(date);
  const name = index === null ? undefined : LONG_NAMES[index];
  if (name === undefined) return '';
  return style === 'long' ? name : name.slice(0, 3);
}

interface DayExtraction {
  /** Days from today (0-6). Undefined when the text names no day. */
  day?: number;
  /** True when a day was named but lies beyond the 7-day forecast. */
  unreachable: boolean;
  /** The text without the day phrase. */
  rest: string;
}

const SMALL_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

interface DayRule {
  pattern: RegExp;
  resolve(match: RegExpExecArray, today: number): number;
}

/** "tomorrow morning", "saturday night": the part of the day does not change the day. */
const PART_OF_DAY = '(?: (?:morning|afternoon|evening|night))?';

const DAY_RULES: readonly DayRule[] = [
  { pattern: new RegExp(`\\b(?:the )?day after tomorrow${PART_OF_DAY}\\b`), resolve: () => 2 },
  { pattern: new RegExp(`\\btomorrow(?:'s|s)?${PART_OF_DAY}\\b`), resolve: () => 1 },
  {
    pattern:
      /\b(?:today(?:'s|s)?|tonight|this (?:morning|afternoon|evening)|in the (?:morning|afternoon|evening)|later today)\b/,
    resolve: () => 0,
  },
  {
    pattern: /\b(?:(?:this|on the|over the|for the|the) )?weekend\b/,
    resolve: (_match, today) => (today === 0 ? 0 : 6 - today),
  },
  {
    pattern: new RegExp(
      `\\b(?:(on|this|next|coming|upcoming) )?(${WEEKDAYS.join('|')})s?${PART_OF_DAY}\\b`,
    ),
    resolve: (match, today) => {
      const target = WEEKDAYS.indexOf((match[2] ?? '') as (typeof WEEKDAYS)[number]);
      const offset = (target - today + 7) % 7;
      return match[1] === 'next' && offset === 0 ? 7 : offset;
    },
  },
  {
    pattern: /\bin (\d{1,2}|one|two|three|four|five|six|seven) days?\b/,
    resolve: (match) => {
      const word = match[1] ?? '';
      return SMALL_NUMBERS[word] ?? Number(word);
    },
  },
];

/**
 * Finds a relative day phrase ("tomorrow", "on saturday", "in 3 days", "this weekend") and
 * resolves it against `now` (system time zone). Only the first phrase is used.
 */
export function extractDay(text: string, now: Date): DayExtraction {
  const today = now.getDay();
  for (const rule of DAY_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const day = rule.resolve(match, today);
    const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return day > 6 ? { unreachable: true, rest } : { day, unreachable: false, rest };
  }
  return { unreachable: false, rest: text };
}

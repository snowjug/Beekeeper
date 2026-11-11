import type { CommandResult, TimeCard } from '@shared/cards';
import { correctTokens, titleCase } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { resolveTimeZone, systemTimeZone } from '../lib/timezones';
import { defineCommand } from '../types';
import type { RunContext } from '../types';

type Focus = TimeCard['focus'];

interface DateTimeSlots {
  focus: Focus;
  /** City, country or zone abbreviation. Undefined = this PC's zone. */
  place?: string;
}

function rx(strings: TemplateStringsArray, ...values: string[]): RegExp {
  return new RegExp(String.raw(strings, ...values));
}

const LEAD = String.raw`(?:(?:what's|what is|what|whats|which|tell me|show me|give me|let me know|do you know|do you have|have you got|got|can i get|can i have)\s+)*`;
const IS_IT = String.raw`(?:\s+(?:is it|it is|is today|is it today))?`;
const NOW = String.raw`(?:\s+(?:now|today|currently))*`;
const PLACE = String.raw`(?:\s+in\s+(?<place>[a-z][a-z .,'-]*))?`;

const PATTERNS: ReadonlyArray<{ focus: Focus; pattern: RegExp }> = [
  {
    focus: 'time',
    pattern: rx`^${LEAD}(?:the\s+)?(?:(?:current|local|exact)\s+)?time${IS_IT}${NOW}${PLACE}$`,
  },
  {
    focus: 'date',
    pattern: rx`^${LEAD}(?:the\s+)?(?:(?:current|today'?s)\s+)?date${IS_IT}${NOW}${PLACE}$`,
  },
  {
    focus: 'day',
    pattern: rx`^${LEAD}(?:the\s+)?(?:current\s+)?day(?:\s+of\s+the\s+week)?${IS_IT}${NOW}${PLACE}$`,
  },
  { focus: 'day', pattern: rx`^(?:what's|what is|whats)\s+today$` },
];

/** Words a typo may be repaired into. Only the words before the place are touched. */
const VOCABULARY = ['time', 'date', 'what', "what's", 'whats', 'tell', 'current', 'today', 'which'];
/** "what time is it in a minute" asks about time, not about a place. */
const NOT_A_PLACE =
  /^(?:an?|the|this|next|one|two|\d+)\s+(?:morning|afternoon|evening|night|seconds?|minutes?|hours?|days?|weeks?|months?|years?|while|bit|moment)$/;

function parse(text: string): { slots: DateTimeSlots; corrected: boolean } | null {
  const tokens = text.split(' ');
  const marker = tokens.indexOf('in');
  const fixed = correctTokens(tokens, VOCABULARY, (index) => marker === -1 || index < marker);
  const candidate = fixed.tokens.join(' ');

  for (const { focus, pattern } of PATTERNS) {
    const match = pattern.exec(candidate);
    if (!match) continue;
    const place = match.groups?.['place']?.trim().replace(/[ ,]+$/, '');
    if (place !== undefined && NOT_A_PLACE.test(place)) return null;
    return { slots: place ? { focus, place } : { focus }, corrected: fixed.corrected };
  }
  return null;
}

function format(now: Date, timeZone: string): { time: string; date: string; weekday: string } {
  const text = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...options })
      .format(now)
      .replace(/[\u202f\u00a0]/g, ' ');
  return {
    time: text({ hour: 'numeric', minute: '2-digit' }),
    date: text({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: text({ weekday: 'long' }),
  };
}

function unknownPlace(place: string, ctx: RunContext): CommandResult {
  const name = titleCase(place);
  const card = statusCard(ctx, {
    tone: 'warning',
    icon: 'clock',
    title: `I don't know the time zone for ${name}`,
    detail: 'Try a major city, like Tokyo or London.',
    actions: [
      {
        type: 'url',
        label: 'Search the web',
        url: `https://www.bing.com/search?q=${encodeURIComponent(`time in ${place}`)}`,
      },
    ],
  });
  return { cards: [card], speech: `I don't know the time zone for ${name}.` };
}

export const dateTimeCommand = defineCommand<DateTimeSlots>({
  id: 'datetime',
  number: 6,
  group: 'info',
  title: 'Time & date',
  icon: 'clock',
  examples: [
    'What time is it?',
    "What's the date?",
    'What day is it?',
    'What time is it in Tokyo?',
  ],

  match(input) {
    const parsed = parse(input.text);
    if (!parsed) return null;
    // A single repaired word ("tiem") is too weak to act on.
    if (parsed.corrected && input.tokens.length < 2) return null;
    return { slots: parsed.slots, score: parsed.corrected ? 0.8 : 0.95 };
  },

  run(slots, ctx) {
    const zone = slots.place === undefined ? null : resolveTimeZone(slots.place);
    if (slots.place !== undefined && zone === null) return unknownPlace(slots.place, ctx);

    const timeZone = zone?.zone ?? systemTimeZone();
    const where = zone ? ` in ${zone.label}` : '';
    const { time, date, weekday } = format(ctx.now, timeZone);

    const card: TimeCard = {
      kind: 'time',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      iso: ctx.now.toISOString(),
      timeText: time,
      dateText: date,
      weekday,
      zone: timeZone,
      focus: slots.focus,
      copyText: `${{ time, date, day: weekday }[slots.focus]}${where}`,
    };

    const speech = {
      time: `It's ${time}${where}.`,
      date: zone ? `It's ${date}${where}.` : `Today is ${date}.`,
      day: `It's ${weekday}${where}.`,
    }[slots.focus];
    return { cards: [card], speech };
  },
});

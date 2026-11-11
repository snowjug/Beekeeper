import type { CardAction, CommandResult, TextCard } from '@shared/cards';
import { matchPhrase } from '../text';
import { defineCommand } from '../types';
import type { RunContext, TimerRecord } from '../types';

type NoSlots = Record<string, never>;

const PATTERNS: readonly RegExp[] = [
  /^good\s+(?:morning|afternoon|evening|day)(?:\s+beekeeper)?$/,
  /^(?:brief|catch)\s+me(?:\s+up)?$/,
  /^(?:give\s+me\s+)?(?:a\s+|my\s+|the\s+)?(?:daily\s+|morning\s+|day\s+)?(?:briefing|brief|rundown|summary|update)(?:\s+(?:for\s+)?(?:today|the\s+day))?$/,
  /^(?:what\s+does\s+my\s+day\s+look\s+like|how(?:'s|\s+is)\s+my\s+day\s+looking|what(?:'s|\s+is)\s+(?:on|happening|going\s+on)\s+today|what\s+do\s+i\s+have\s+(?:on\s+)?today)$/,
];

const PHRASES = [
  'good morning',
  'brief me',
  'daily briefing',
  'morning briefing',
  'give me my briefing',
  'what does my day look like',
];

const MAX_LISTED = 3;

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function endOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function describeTimer(record: TimerRecord): string {
  const label = record.label.trim();
  const when = clock(record.endsAt);
  if (record.type === 'timer') return `${label || 'Timer'} (ends ${when})`;
  return label
    ? `${label} at ${when}`
    : `${record.type === 'alarm' ? 'Alarm' : 'Reminder'} at ${when}`;
}

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

interface Section {
  markdown: string;
  speech: string;
}

async function weatherSection(ctx: RunContext): Promise<Section | null> {
  try {
    const forecast = await ctx.services.weather.forecast({ units: ctx.settings.units });
    const today = forecast.days[0];
    if (!today) return null;
    const city = forecast.place.split(',')[0]?.trim() || forecast.place;
    const unit = forecast.units === 'imperial' ? 'F' : 'C';
    const rain = today.precipChance >= 50 ? `, ${today.precipChance}% chance of rain` : '';
    const rainSpeech =
      today.precipChance >= 50 ? `, with a ${today.precipChance} percent chance of rain` : '';
    return {
      markdown: `**${city}** — ${Math.round(forecast.current.temp)}°${unit}, ${forecast.current.summary.toLowerCase()} (high ${Math.round(today.tempMax)}°, low ${Math.round(today.tempMin)}°${rain})`,
      speech: `In ${city} it's ${Math.round(forecast.current.temp)} degrees and ${forecast.current.summary.toLowerCase()}, with a high of ${Math.round(today.tempMax)}${rainSpeech}.`,
    };
  } catch {
    // Offline or no location: the briefing simply skips the weather.
    return null;
  }
}

function agendaSection(ctx: RunContext): Section | null {
  const limit = endOfDay(ctx.now);
  const due = ctx.services.timers
    .list()
    .filter((record) => record.state === 'running' && record.endsAt <= limit)
    .sort((a, b) => a.endsAt - b.endsAt);
  if (due.length === 0) return null;
  const listed = due.slice(0, MAX_LISTED);
  const extra = due.length - listed.length;
  return {
    markdown: [
      `**Today** — ${plural(due.length, 'reminder or timer', 'reminders or timers')}`,
      ...listed.map((record) => `- ${describeTimer(record)}`),
      ...(extra > 0 ? [`- and ${extra} more`] : []),
    ].join('\n'),
    speech: `You have ${plural(due.length, 'reminder or timer', 'reminders or timers')} today: ${listed
      .map(describeTimer)
      .join(', then ')}${extra > 0 ? `, and ${extra} more` : ''}.`,
  };
}

function notesSection(ctx: RunContext): Section | null {
  const { total } = ctx.services.notes.list(undefined, 1);
  if (total === 0) return null;
  return {
    markdown: `**Notes** — ${plural(total, 'saved note')}`,
    speech: `You have ${plural(total, 'saved note')}.`,
  };
}

const ACTIONS: CardAction[] = [
  { type: 'command', label: 'Weather', text: 'weather' },
  { type: 'command', label: 'My notes', text: 'show my notes' },
];

/** "Good morning" / "brief me": date, weather, today's reminders and notes in one answer. */
export const briefingCommand = defineCommand<NoSlots>({
  id: 'briefing',
  number: 40,
  group: 'info',
  title: 'Daily briefing',
  icon: 'sparkle',
  examples: ['Good morning', 'Brief me', 'Daily briefing', 'What does my day look like'],

  match(input) {
    if (PATTERNS.some((pattern) => pattern.test(input.text))) return { slots: {}, score: 0.93 };
    return matchPhrase(input.text, PHRASES) === null ? null : { slots: {}, score: 0.8 };
  },

  async run(_slots, ctx): Promise<CommandResult> {
    const dateText = ctx.now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const greeting = greetingFor(ctx.now.getHours());
    const sections = [await weatherSection(ctx), agendaSection(ctx), notesSection(ctx)].filter(
      (section): section is Section => section !== null,
    );

    const markdown = [`**${dateText}**`, ...sections.map((section) => section.markdown)].join(
      '\n\n',
    );
    const closing = ctx.now.getHours() < 12 ? 'Have a great day!' : 'Anything else I can do?';
    const speech = [
      `${greeting}! It's ${dateText}.`,
      ...(sections.length === 0
        ? ['Your day looks clear.']
        : sections.map((section) => section.speech)),
      closing,
    ].join(' ');

    const card: TextCard = {
      kind: 'text',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      title: `${greeting}`,
      markdown,
      copyText: markdown.replace(/\*\*/g, ''),
      actions: ACTIONS,
    };
    return { cards: [card], speech, pin: true, context: { briefing: true } };
  },
});

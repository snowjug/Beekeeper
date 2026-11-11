import type { CardIcon, CommandResult } from '@shared/cards';
import { matchLeadingVerb } from '../text';
import { findDuration, formatClock, formatDuration, formatRemaining } from '../timeparse';
import type { RunContext, TimerRecord } from '../types';
import { capitalize, count, statusCard, timerCard } from './shared';

export type ScheduledType = TimerRecord['type'];

export interface NounSpec {
  type: ScheduledType;
  /** Word used in messages. */
  name: string;
  /** Spoken or typed spellings that are correct. */
  exact: ReadonlySet<string>;
  singular: ReadonlySet<string>;
  plural: ReadonlySet<string>;
}

function nounSpec(
  type: ScheduledType,
  name: string,
  exact: readonly string[],
  typos: readonly string[],
): NounSpec {
  const singular = [...exact, ...typos];
  return {
    type,
    name,
    exact: new Set(exact.flatMap((word) => [word, `${word}s`])),
    singular: new Set(singular),
    plural: new Set(singular.map((word) => `${word}s`)),
  };
}

export const TIMER_NOUN = nounSpec(
  'timer',
  'timer',
  ['timer', 'countdown'],
  ['tiemr', 'timr', 'tmer', 'timmer', 'timre', 'tmier', 'timerr', 'timeer', 'tiimer'],
);
export const ALARM_NOUN = nounSpec(
  'alarm',
  'alarm',
  ['alarm'],
  ['alram', 'alarn', 'alrm', 'allarm', 'alarmm', 'alaram', 'alarem', 'alamr'],
);
export const REMINDER_NOUN = nounSpec(
  'reminder',
  'reminder',
  ['reminder'],
  ['remindr', 'remnder', 'remindar', 'reminer', 'remider', 'remindder', 'reminderr', 'reminedr'],
);

export function isNoun(spec: NounSpec, token: string): boolean {
  return spec.singular.has(token) || spec.plural.has(token);
}

/** False when the noun was misspelled, which lowers the matcher's confidence a little. */
export function isExactNoun(spec: NounSpec, token: string): boolean {
  return spec.exact.has(token);
}

const ICONS: Readonly<Record<ScheduledType, CardIcon>> = {
  timer: 'timer',
  alarm: 'alarm',
  reminder: 'bell',
};

// ---------------------------------------------------------------------------
// "show my timers" / "cancel the timer" style requests
// ---------------------------------------------------------------------------

export type Target =
  | { kind: 'latest' }
  | { kind: 'all' }
  | { kind: 'label'; words: string[] }
  | { kind: 'duration'; ms: number }
  | { kind: 'clock'; minuteOfDay: number };

export type ManageIntent = { action: 'list' } | { action: 'cancel'; target: Target };

const CANCEL_VERBS: readonly string[] = [
  'cancel',
  'stop',
  'delete',
  'remove',
  'clear',
  'end',
  'kill',
  'dismiss',
  'abort',
  'discard',
  'turn off',
  'switch off',
];
const LIST_VERBS: readonly string[] = ['show', 'list', 'view', 'check', 'see', 'display'];
const ALL_WORDS: ReadonlySet<string> = new Set(['all', 'every', 'everything', 'both']);
const LABEL_MARKERS: ReadonlySet<string> = new Set([
  'called',
  'named',
  'labeled',
  'labelled',
  'titled',
]);
/** Words that carry no information about *which* record the user means. */
const SELECTOR_FILLER: ReadonlySet<string> = new Set([
  'my',
  'the',
  'that',
  'this',
  'current',
  'last',
  'latest',
  'recent',
  'newest',
  'running',
  'active',
  'any',
  'of',
  'those',
  'these',
  'me',
  'it',
  'a',
  'an',
  'one',
  'our',
  'your',
  'next',
  'upcoming',
  'scheduled',
  'pending',
  'for',
  'to',
  'on',
  'in',
  'at',
]);
const BARE_WORDS: ReadonlySet<string> = new Set([
  'my',
  'the',
  'your',
  'our',
  'all',
  'any',
  'current',
  'running',
  'active',
  'upcoming',
  'next',
  'scheduled',
  'pending',
  'of',
  'me',
  'status',
]);
const QUESTION_STARTERS: ReadonlySet<string> = new Set([
  'what',
  'whats',
  "what's",
  'which',
  'when',
  "when's",
  'do',
  'does',
  'are',
  'is',
  'how',
  'any',
  'have',
]);
const QUESTION_CUES: ReadonlySet<string> = new Set([
  'my',
  'i',
  'have',
  'got',
  'there',
  'running',
  'active',
  'set',
  'scheduled',
  'pending',
  'current',
  'any',
  'next',
  'upcoming',
  'still',
]);
const QUESTION_WORDS: ReadonlySet<string> = new Set([
  ...QUESTION_CUES,
  'what',
  'whats',
  "what's",
  'which',
  'when',
  "when's",
  'do',
  'does',
  'are',
  'is',
  'a',
  'an',
  'the',
  'your',
  'our',
  'how',
  'many',
  'for',
  'on',
  'me',
  'all',
  'of',
  'those',
  'these',
  'this',
  'that',
  'it',
  'at',
  'time',
  'left',
  'going',
]);

function parseCancel(rest: readonly string[], spec: NounSpec): ManageIntent | null {
  const nounAt = rest.findIndex((token) => isNoun(spec, token));
  if (nounAt < 0) return null;
  const others = rest.filter((_, index) => index !== nounAt);
  const everything =
    others.some((token) => ALL_WORDS.has(token)) || spec.plural.has(rest[nounAt] ?? '');
  const leftover = others.filter((token) => !SELECTOR_FILLER.has(token) && !ALL_WORDS.has(token));
  if (leftover.length === 0) {
    return { action: 'cancel', target: everything ? { kind: 'all' } : { kind: 'latest' } };
  }
  const duration = findDuration(leftover);
  if (duration !== null) {
    return { action: 'cancel', target: { kind: 'duration', ms: duration.ms } };
  }
  const words = leftover.filter((token) => !LABEL_MARKERS.has(token));
  return {
    action: 'cancel',
    target: words.length === 0 ? { kind: 'latest' } : { kind: 'label', words },
  };
}

/**
 * Recognises "show my timers", "what alarms do I have", "my reminders" (list) and
 * "cancel the timer", "delete all reminders" (cancel) for one kind of record.
 */
export function parseManage(
  text: string,
  spec: NounSpec,
  cancelVerbs: readonly string[] = CANCEL_VERBS,
): ManageIntent | null {
  const tokens = text.split(' ');
  if (!tokens.some((token) => isNoun(spec, token))) return null;

  const cancel = matchLeadingVerb(text, cancelVerbs);
  if (cancel !== null) return parseCancel(cancel.rest.split(' ').filter(Boolean), spec);

  if (matchLeadingVerb(text, LIST_VERBS) !== null) return { action: 'list' };
  if (tokens.every((token) => BARE_WORDS.has(token) || isNoun(spec, token))) {
    return { action: 'list' };
  }
  const isQuestion =
    QUESTION_STARTERS.has(tokens[0] ?? '') &&
    tokens.every((token) => QUESTION_WORDS.has(token) || isNoun(spec, token)) &&
    tokens.some((token) => QUESTION_CUES.has(token));
  return isQuestion ? { action: 'list' } : null;
}

/** The records a target refers to; a single record unless the target is "all". */
function selectRecords(records: readonly TimerRecord[], target: Target): TimerRecord[] {
  if (target.kind === 'all') return [...records];
  const matching = records.filter((record) => {
    switch (target.kind) {
      case 'label': {
        const label = record.label.toLowerCase();
        return target.words.every((word) => label.includes(word));
      }
      case 'duration':
        return Math.abs(record.durationMs - target.ms) <= 1_000;
      case 'clock': {
        const due = new Date(record.endsAt);
        return due.getHours() * 60 + due.getMinutes() === target.minuteOfDay;
      }
      case 'latest':
        return true;
    }
  });
  const newest = [...matching].sort((a, b) => b.startedAt - a.startedAt || b.endsAt - a.endsAt)[0];
  return newest === undefined ? [] : [newest];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** "at 3:30 PM", "tomorrow at 9:00 AM", "Friday at 9:00 AM". */
export function atPhrase(date: Date, now: Date): string {
  const clock = formatClock(date, now);
  return /^\d/.test(clock) ? `at ${clock}` : clock;
}

/** "Tea (2:30 left)" for timers, "Call mom (at 4:32 PM)" for the rest. */
function brief(record: TimerRecord, ctx: RunContext): string {
  const when =
    record.type === 'timer'
      ? `${formatRemaining(record.endsAt - ctx.now.getTime())} left`
      : atPhrase(new Date(record.endsAt), ctx.now);
  return `${record.label} (${when})`;
}

function describeOne(record: TimerRecord, ctx: RunContext): string {
  const left = formatDuration(Math.max(0, record.endsAt - ctx.now.getTime()));
  const due = atPhrase(new Date(record.endsAt), ctx.now);
  switch (record.type) {
    case 'timer':
      return record.label === 'Timer'
        ? `${left} left on your timer`
        : `${record.label} has ${left} left`;
    case 'alarm':
      return `Your alarm is set for ${due}`;
    case 'reminder':
      return `Reminder ${due}: ${record.label}`;
  }
}

function describeMany(
  records: readonly TimerRecord[],
  first: TimerRecord,
  spec: NounSpec,
  ctx: RunContext,
): string {
  const due = atPhrase(new Date(first.endsAt), ctx.now);
  switch (spec.type) {
    case 'timer': {
      const left = formatDuration(Math.max(0, first.endsAt - ctx.now.getTime()));
      return `You have ${count(records.length, 'timer')} running. The next one has ${left} left.`;
    }
    case 'alarm':
      return `You have ${count(records.length, 'alarm')} set. The next one is ${due}.`;
    case 'reminder':
      return `You have ${count(records.length, 'reminder')}. The next one is ${due}: ${first.label}.`;
  }
}

const EMPTY_TITLES: Readonly<Record<ScheduledType, string>> = {
  timer: 'No timers running',
  alarm: 'No alarms set',
  reminder: 'No reminders scheduled',
};
const EMPTY_SPEECH: Readonly<Record<ScheduledType, string>> = {
  timer: 'You have no timers running.',
  alarm: "You don't have any alarms set.",
  reminder: "You don't have any reminders scheduled.",
};
const EMPTY_HINTS: Readonly<Record<ScheduledType, string>> = {
  timer: 'Say "set a timer for 5 minutes" to start one.',
  alarm: 'Say "set an alarm for 7 am" to add one.',
  reminder: 'Say "remind me in 10 minutes to call mom" to add one.',
};

/** One timer card per running record (soonest first), or a friendly "nothing here" card. */
export function listResult(ctx: RunContext, spec: NounSpec): CommandResult {
  const records = ctx.services.timers.list().filter((record) => record.type === spec.type);
  const first = records[0];
  if (first === undefined) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: ICONS[spec.type],
          title: EMPTY_TITLES[spec.type],
          detail: EMPTY_HINTS[spec.type],
        }),
      ],
      speech: EMPTY_SPEECH[spec.type],
      autoCloseMs: 3500,
    };
  }
  return {
    cards: records.map((record) => timerCard(ctx, record)),
    speech:
      records.length === 1 ? describeOne(first, ctx) : describeMany(records, first, spec, ctx),
    pin: true,
  };
}

/** Cancels the records `target` refers to and reports what happened. */
export function cancelResult(ctx: RunContext, spec: NounSpec, target: Target): CommandResult {
  const running = ctx.services.timers.list().filter((record) => record.type === spec.type);
  if (running.length === 0) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: ICONS[spec.type],
          title: EMPTY_TITLES[spec.type],
          detail: 'There is nothing to cancel.',
        }),
      ],
      speech: `You don't have any ${spec.name}s to cancel.`,
      autoCloseMs: 2500,
    };
  }

  const selected = selectRecords(running, target);
  if (selected.length === 0) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'warning',
          icon: ICONS[spec.type],
          title: `I couldn't find that ${spec.name}`,
          detail: `You have: ${running.map((record) => brief(record, ctx)).join(', ')}.`,
        }),
      ],
      speech: `I couldn't find that ${spec.name}.`,
      autoCloseMs: 4000,
    };
  }

  const cancelled = selected.filter((record) => ctx.services.timers.cancel(record.id));
  const only = cancelled[0];
  if (only === undefined) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: ICONS[spec.type],
          title: `That ${spec.name} just finished`,
        }),
      ],
      speech: `That ${spec.name} just finished.`,
      autoCloseMs: 2500,
    };
  }
  if (target.kind !== 'all') {
    return {
      cards: [timerCard(ctx, only, 'cancelled')],
      speech: `${capitalize(spec.name)} cancelled`,
      autoCloseMs: 2500,
    };
  }
  return {
    cards: [
      statusCard(ctx, {
        tone: 'success',
        icon: 'check',
        title:
          cancelled.length === 1
            ? `Cancelled your ${spec.name}`
            : `Cancelled ${count(cancelled.length, spec.name)}`,
      }),
    ],
    speech:
      cancelled.length === 1
        ? `${capitalize(spec.name)} cancelled`
        : `All ${count(cancelled.length, spec.name)} cancelled`,
    autoCloseMs: 2500,
  };
}

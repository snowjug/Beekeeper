import type { CommandResult } from '@shared/cards';
import { stripArticles } from '../text';
import { findDuration, formatDuration, parseDuration, type DurationMatch } from '../timeparse';
import {
  defineCommand,
  type CommandMatch,
  type NormalizedInput,
  type ParseContext,
  type RunContext,
} from '../types';
import {
  TIMER_NOUN,
  cancelResult,
  isExactNoun,
  isNoun,
  listResult,
  parseManage,
  type ManageIntent,
} from './scheduled';
import {
  capitalize,
  matchSetVerb,
  pendingQuestion,
  restoreCase,
  statusCard,
  timerCard,
} from './shared';

/** Longer waits belong to reminders. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const MAX_LABEL_LENGTH = 60;

type TimerSlots = ManageIntent | { action: 'start'; durationMs: number | null; label?: string };

const START_VERBS = [
  'set',
  'start',
  'create',
  'make',
  'begin',
  'run',
  'add',
  'put',
  'launch',
  'new',
];
const FILLERS: ReadonlySet<string> = new Set([
  'me',
  'the',
  'my',
  'new',
  'another',
  'quick',
  'our',
  'up',
]);
const ARTICLES: ReadonlySet<string> = new Set(['a', 'an']);
const DURATION_PREPOSITIONS: ReadonlySet<string> = new Set(['for', 'in', 'of', 'to']);
const LABEL_MARKERS: ReadonlySet<string> = new Set([
  'called',
  'named',
  'labeled',
  'labelled',
  'titled',
  'for',
]);

const TIME_LEFT_WITH_NOUN =
  /\b(?:how (?:much )?(?:time|longer)|how long|how many (?:minutes|seconds|hours)|time (?:left|remaining)|(?:left|remaining) (?:on|in|for))\b/;
const TIME_LEFT_ALONE =
  /^(?:how (?:much )?(?:time|longer)(?: is| do i have)?(?: left| remaining)?|how long(?: is)? (?:left|remaining)|(?:what(?:'s| is) )?(?:the )?time (?:left|remaining)|how many (?:minutes|seconds) (?:are )?left)$/;

interface StartHit {
  durationMs: number | null;
  label: string | null;
  score: number;
}

function searchNoun(tokens: readonly string[], from: number, count: number): number {
  const end = Math.min(tokens.length, from + count);
  for (let index = from; index < end; index += 1) {
    if (TIMER_NOUN.singular.has(tokens[index] ?? '')) return index;
  }
  return -1;
}

/**
 * "set a timer for 5 minutes", "5 minute timer", "timer for 30 seconds called pasta",
 * "start a 10 minute tea timer". Anchored at the start so "remind me to set a timer" is not a timer.
 */
function parseStart(input: NormalizedInput): StartHit | null {
  const { text, tokens } = input;
  const verb = matchSetVerb(text, START_VERBS);
  let index = verb === null ? 0 : 1;
  while (FILLERS.has(tokens[index] ?? '')) index += 1;

  const lead = findDuration(tokens, index);
  const leadFirst =
    lead !== null &&
    (lead.start === index || (lead.start === index + 1 && ARTICLES.has(tokens[index] ?? '')))
      ? lead
      : null;
  let before: DurationMatch | null = null;
  let nounAt = -1;
  if (leadFirst !== null) {
    nounAt = searchNoun(tokens, leadFirst.end, verb === null ? 1 : 3);
    if (nounAt >= 0) before = leadFirst;
  }
  if (nounAt < 0) nounAt = searchNoun(tokens, index, verb === null ? 2 : 5);
  if (nounAt < 0) return null;

  const duration = before ?? findDuration(tokens, nounAt + 1);
  if (verb === null && duration === null) return null;
  let confidence = verb === null ? 90 : verb.exact ? 95 : 91;
  if (!isExactNoun(TIMER_NOUN, tokens[nounAt] ?? '')) confidence -= 4;

  const used = new Set<number>();
  for (let at = 0; at < index; at += 1) used.add(at);
  used.add(nounAt);
  for (let at = 0; at < nounAt; at += 1) {
    const token = tokens[at] ?? '';
    if (ARTICLES.has(token) || FILLERS.has(token)) used.add(at);
  }
  if (duration !== null) {
    for (let at = duration.start; at < duration.end; at += 1) used.add(at);
    if (DURATION_PREPOSITIONS.has(tokens[duration.start - 1] ?? '')) used.add(duration.start - 1);
  }
  const unused = tokens.map((_, at) => at).filter((at) => !used.has(at));
  const marker = unused.findIndex((at) => LABEL_MARKERS.has(tokens[at] ?? ''));
  const labelAt =
    marker >= 0 && marker < unused.length - 1
      ? unused.slice(marker + 1)
      : unused.filter((at) => at < nounAt);
  const labelText = stripArticles(labelAt.map((at) => tokens[at] ?? '').join(' '));
  const label =
    labelText === ''
      ? null
      : capitalize(restoreCase(input.raw, labelText)).slice(0, MAX_LABEL_LENGTH);

  return {
    durationMs: duration?.ms ?? null,
    label,
    score: (duration === null ? 70 : confidence) / 100,
  };
}

function startSlots(durationMs: number | null, label: string | null): TimerSlots {
  return label === null ? { action: 'start', durationMs } : { action: 'start', durationMs, label };
}

function matchTimer(input: NormalizedInput, ctx: ParseContext): CommandMatch<TimerSlots> | null {
  const { text, tokens } = input;
  if (text === '') return null;

  if (tokens.some((token) => isNoun(TIMER_NOUN, token))) {
    if (TIME_LEFT_WITH_NOUN.test(text)) return { slots: { action: 'list' }, score: 0.92 };
    const manage = parseManage(text, TIMER_NOUN);
    if (manage !== null) return { slots: manage, score: manage.action === 'cancel' ? 0.95 : 0.9 };
    const start = parseStart(input);
    return start === null
      ? null
      : { slots: startSlots(start.durationMs, start.label), score: start.score };
  }

  if (TIME_LEFT_ALONE.test(text)) return { slots: { action: 'list' }, score: 0.7 };

  const asked = pendingQuestion(ctx, 'timer', 'timer-duration');
  const durationMs = asked === null ? null : parseDuration(text);
  if (asked !== null && durationMs !== null) {
    const label = typeof asked.label === 'string' ? asked.label : null;
    return { slots: startSlots(durationMs, label), score: 0.6 };
  }
  return null;
}

function startTimer(
  slots: { durationMs: number | null; label?: string },
  ctx: RunContext,
): CommandResult {
  const { durationMs, label } = slots;
  if (durationMs === null) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: 'timer',
          title: 'How long should the timer run?',
          detail: 'For example: "set a timer for 5 minutes".',
        }),
      ],
      speech: 'How long should the timer run?',
      pin: true,
      context: { awaiting: 'timer-duration', ...(label === undefined ? {} : { label }) },
    };
  }
  if (durationMs <= 0) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'warning',
          icon: 'timer',
          title: 'A timer needs some time',
          detail: 'Try a duration such as "5 minutes" or "30 seconds".',
        }),
      ],
      speech: 'A timer needs to run for at least a moment.',
      autoCloseMs: 4000,
    };
  }
  if (durationMs > MAX_TIMER_MS) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'warning',
          icon: 'timer',
          title: "That's too long for a timer",
          detail:
            'Timers can run for up to 24 hours. For longer waits, try a reminder such as "remind me in 2 days to renew the ticket".',
        }),
      ],
      speech: 'Timers can run for up to 24 hours.',
      autoCloseMs: 5000,
    };
  }

  const record = ctx.services.timers.startTimer({ durationMs, label });
  return {
    cards: [timerCard(ctx, record)],
    speech: `Timer set for ${formatDuration(durationMs)}${label === undefined ? '' : ` called ${label}`}`,
    pin: true,
  };
}

export const timerCommand = defineCommand<TimerSlots>({
  id: 'timer',
  number: 13,
  group: 'productivity',
  title: 'Timers',
  icon: 'timer',
  examples: [
    'set a timer for 5 minutes',
    'timer for 30 seconds',
    'how much time is left on my timer',
    'cancel my timer',
  ],
  match: matchTimer,
  run(slots, ctx) {
    if (slots.action === 'list') return listResult(ctx, TIMER_NOUN);
    if (slots.action === 'cancel') return cancelResult(ctx, TIMER_NOUN, slots.target);
    return startTimer(slots, ctx);
  },
});

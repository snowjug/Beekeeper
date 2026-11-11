import type { CardAction, CardIcon, CardTone, StatusCard, TimerCard } from '@shared/cards';
import { levenshtein, matchLeadingVerb } from '../text';
import {
  findClockTime,
  findDuration,
  isDayWord,
  parseDuration,
  type ClockTimeOptions,
} from '../timeparse';
import type { ParseContext, RunContext, TimerRecord } from '../types';

/** A question the user was asked stays answerable for this long. */
const FOLLOW_UP_WINDOW_MS = 2 * 60 * 1000;

export interface StatusOptions {
  tone: CardTone;
  icon: CardIcon;
  title: string;
  detail?: string;
  actions?: CardAction[];
  copyText?: string;
}

export function statusCard(ctx: RunContext, options: StatusOptions): StatusCard {
  const card: StatusCard = {
    kind: 'status',
    id: ctx.newId(),
    createdAt: ctx.now.getTime(),
    tone: options.tone,
    icon: options.icon,
    title: options.title,
  };
  if (options.detail !== undefined) card.detail = options.detail;
  if (options.actions !== undefined) card.actions = options.actions;
  if (options.copyText !== undefined) card.copyText = options.copyText;
  return card;
}

export function timerCard(
  ctx: RunContext,
  record: TimerRecord,
  state: TimerCard['state'] = record.state,
): TimerCard {
  return {
    kind: 'timer',
    id: ctx.newId(),
    createdAt: ctx.now.getTime(),
    timerId: record.id,
    timerType: record.type,
    label: record.label,
    durationMs: record.durationMs,
    startedAt: record.startedAt,
    endsAt: record.endsAt,
    state,
  };
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "1 note", "2 notes". */
export function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

/** `text` on one line, shortened to at most `max` characters with an ellipsis. */
export function snippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** "Call mom" -> "call mom", but "NASA launch" and "I need milk" stay as they are. */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Input is lower-cased before matching; this finds `phrase` (already lower case, single spaced) in
 * the original text again so names and acronyms keep their capitals ("email John").
 */
export function restoreCase(raw: string, phrase: string): string {
  if (phrase === '') return phrase;
  const flat = raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  const index = lower.length === flat.length ? lower.indexOf(phrase) : -1;
  return index === -1 ? phrase : flat.slice(index, index + phrase.length);
}

/**
 * Context returned with the previous turn when this command asked the user a question
 * (`awaiting` names it) and the answer is still welcome. Null otherwise.
 */
export function pendingQuestion(
  ctx: ParseContext,
  commandId: string,
  awaiting: string,
): Record<string, unknown> | null {
  const turn = ctx.turns[ctx.turns.length - 1];
  if (turn === undefined || turn.commandId !== commandId) return null;
  if (ctx.now.getTime() - turn.at > FOLLOW_UP_WINDOW_MS) return null;
  return turn.context?.awaiting === awaiting ? turn.context : null;
}

/** A leading "set"/"create"/... (or a one-letter slip such as "sett"). `exact` is false for slips. */
export function matchSetVerb(text: string, verbs: readonly string[]): { exact: boolean } | null {
  const hit = matchLeadingVerb(text, verbs);
  if (hit !== null) return { exact: hit.exact };
  const first = text.split(' ', 1)[0] ?? '';
  const slip =
    first.length >= 3 &&
    first.length <= 4 &&
    first.startsWith('s') &&
    levenshtein(first, 'set', 1) <= 1;
  return slip ? { exact: false } : null;
}

interface RelativeTime {
  ms: number;
  /** Indices of the tokens that express it ("in", "10", "minutes"). */
  consumed: number[];
}

const RELATIVE_MARKERS: ReadonlySet<string> = new Set(['in', 'after', 'within']);

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, offset) => start + offset);
}

/**
 * "in 10 minutes", "after an hour", "10 minutes from now", "10 minutes later", or "for 10 minutes"
 * as the first words. A duration without such a cue is part of the sentence, not a time.
 */
function findRelativeTime(tokens: readonly string[]): RelativeTime | null {
  let from = 0;
  for (;;) {
    const found = findDuration(tokens, from);
    if (found === null) return null;
    const before = tokens[found.start - 1] ?? '';
    const cued = RELATIVE_MARKERS.has(before) || (before === 'for' && found.start === 1);
    const tail =
      tokens[found.end] === 'from' && tokens[found.end + 1] === 'now'
        ? 2
        : tokens[found.end] === 'later'
          ? 1
          : 0;
    if (cued || tail > 0) {
      return {
        ms: found.ms,
        consumed: range(cued ? found.start - 1 : found.start, found.end + tail),
      };
    }
    from = found.end;
  }
}

export interface ScheduleTime {
  /** Epoch milliseconds. */
  at: number;
  /** Indices of the tokens that express the time. */
  consumed: number[];
}

/**
 * The relative ("in 10 minutes") or clock ("at 3:30 pm", "tomorrow at 9") time in a sentence;
 * when both are present the one that comes first wins.
 */
export function findScheduleTime(
  tokens: readonly string[],
  now: Date,
  options?: ClockTimeOptions,
): ScheduleTime | null {
  const relative = findRelativeTime(tokens);
  const clock = findClockTime(tokens, now, options);
  const relativeStart = relative === null ? Infinity : Math.min(...relative.consumed);
  const clockStart = clock === null ? Infinity : Math.min(...clock.consumed);
  if (relative !== null && relativeStart <= clockStart) {
    return { at: now.getTime() + relative.ms, consumed: relative.consumed };
  }
  return clock === null ? null : { at: clock.at.getTime(), consumed: clock.consumed };
}

/** "tomorrow" in "remind me tomorrow to call mom": a day word that opens or closes the request. */
export function findDayWord(tokens: readonly string[]): { index: number; word: string } | null {
  for (const index of [0, tokens.length - 1]) {
    const word = tokens[index];
    if (word !== undefined && isDayWord(word)) return { index, word };
  }
  return null;
}

/**
 * The time in a short answer to "When should I remind you?": "at 5pm", "in 10 minutes", "9",
 * optionally for a `day` the user named earlier. Epoch milliseconds, or null.
 */
export function findAnsweredTime(
  input: { text: string; tokens: readonly string[] },
  now: Date,
  day?: string,
  options?: ClockTimeOptions,
): number | null {
  const tokens = day === undefined ? input.tokens : [...input.tokens, day];
  const found =
    findScheduleTime(tokens, now, options) ??
    (input.tokens.length === 1 ? findScheduleTime(['at', ...tokens], now, options) : null);
  if (found !== null) return found.at;
  const ms = parseDuration(input.text);
  return ms !== null && ms > 0 ? now.getTime() + ms : null;
}

const REPEAT_WORDS: ReadonlySet<string> = new Set([
  'daily',
  'weekly',
  'hourly',
  'monthly',
  'yearly',
  'nightly',
]);
const REPEAT_UNITS: ReadonlySet<string> = new Set([
  'day',
  'morning',
  'afternoon',
  'evening',
  'night',
  'week',
  'weekday',
  'weekend',
  'month',
  'year',
  'hour',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

/** Indices of words that ask for a repeat ("every day", "daily"); empty when there are none. */
export function findRepetition(tokens: readonly string[]): number[] {
  const found: number[] = [];
  tokens.forEach((token, index) => {
    if (REPEAT_WORDS.has(token)) {
      found.push(index);
    } else if (token === 'every' || token === 'each') {
      const skip = tokens[index + 1] === 'other' ? 1 : 0;
      if (REPEAT_UNITS.has(tokens[index + 1 + skip] ?? '')) {
        found.push(...range(index, index + 2 + skip));
      }
    }
  });
  return found;
}

const LEADING_FILLER: ReadonlySet<string> = new Set(['to', 'and', 'then', 'also']);
const DANGLING: ReadonlySet<string> = new Set([
  'at',
  'by',
  'on',
  'in',
  'for',
  'around',
  'about',
  'till',
  'until',
  'before',
  'after',
  'within',
  'to',
  'of',
  'from',
  'and',
  'then',
  'the',
  'a',
  'an',
  'that',
  'is',
  'are',
]);

/**
 * What is left of a sentence once the time words are cut out: connecting words at both ends are
 * dropped and the user's capitalisation is restored.
 */
export function remainingText(
  raw: string,
  tokens: readonly string[],
  consumed: ReadonlySet<number>,
): string {
  const kept = tokens.map((_, index) => index).filter((index) => !consumed.has(index));
  while (kept.length > 0 && LEADING_FILLER.has(tokens[kept[0] ?? 0] ?? '')) kept.shift();
  while (kept.length > 0 && DANGLING.has(tokens[kept[kept.length - 1] ?? 0] ?? '')) kept.pop();

  const runs: number[][] = [];
  for (const index of kept) {
    const run = runs[runs.length - 1];
    if (run !== undefined && run[run.length - 1] === index - 1) run.push(index);
    else runs.push([index]);
  }
  return runs
    .map((run) => restoreCase(raw, run.map((index) => tokens[index] ?? '').join(' ')))
    .join(' ');
}

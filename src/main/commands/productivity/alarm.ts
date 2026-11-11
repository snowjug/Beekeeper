import type { CommandResult } from '@shared/cards';
import { matchLeadingVerb } from '../text';
import { findClockTime, formatClock, formatDuration } from '../timeparse';
import {
  defineCommand,
  type CommandMatch,
  type NormalizedInput,
  type ParseContext,
  type RunContext,
} from '../types';
import {
  ALARM_NOUN,
  cancelResult,
  isExactNoun,
  listResult,
  parseManage,
  type ManageIntent,
} from './scheduled';
import {
  findAnsweredTime,
  findDayWord,
  findRepetition,
  findScheduleTime,
  matchSetVerb,
  pendingQuestion,
  statusCard,
} from './shared';

/** Alarms further out than this are refused. */
const MAX_ALARM_MS = 366 * 24 * 60 * 60 * 1000;

/** `day` remembers "tomorrow" from "set an alarm for tomorrow" while the time is asked for. */
type AlarmSlots =
  ManageIntent | { at: number; repeating?: true } | { problem: 'missing-time'; day?: string };

const SET_VERBS = ['set', 'create', 'add', 'make', 'schedule', 'new', 'put', 'start'];
/** "stop" is left out on purpose: it silences a ringing alarm and must not delete the next one. */
const CANCEL_VERBS = ['cancel', 'delete', 'remove', 'clear', 'discard', 'turn off', 'switch off'];

interface AlarmLead {
  /** First token after the introduction; the time usually follows. */
  from: number;
  /** Token range between the verb and the alarm word ("set a 7 am alarm"). */
  before: [number, number];
  exact: boolean;
  /** The request is clearly about an alarm ("set an alarm", "wake me up"), so a missing time is asked for. */
  explicit: boolean;
}

/** "set an alarm ...", "7 am alarm", "wake me up ...": where the sentence introduces an alarm. */
function leadingAlarm(text: string, tokens: readonly string[]): AlarmLead | null {
  const wake = matchLeadingVerb(text, ['wake']);
  if (wake !== null && (tokens[1] === 'me' || tokens[1] === 'up')) {
    let from = 1;
    if (tokens[from] === 'me') from += 1;
    if (tokens[from] === 'up') from += 1;
    return { from, before: [0, 0], exact: wake.exact, explicit: from === tokens.length };
  }

  const verb = matchSetVerb(text, SET_VERBS);
  const first = verb === null ? 0 : 1;
  const last = Math.min(tokens.length, first + (verb === null ? 4 : 5));
  let nounAt = -1;
  for (let at = first; at < last && nounAt < 0; at += 1) {
    if (ALARM_NOUN.singular.has(tokens[at] ?? '')) nounAt = at;
  }
  if (nounAt < 0) return null;
  const clock = tokens[nounAt + 1] === 'clock' ? 1 : 0;
  return {
    from: nounAt + 1 + clock,
    before: [first, nounAt],
    exact: (verb?.exact ?? true) && isExactNoun(ALARM_NOUN, tokens[nounAt] ?? ''),
    explicit: verb !== null,
  };
}

function matchAlarm(input: NormalizedInput, ctx: ParseContext): CommandMatch<AlarmSlots> | null {
  const { text, tokens } = input;
  if (text === '') return null;

  const manage = parseManage(text, ALARM_NOUN, CANCEL_VERBS);
  if (manage !== null) {
    if (manage.action === 'cancel' && manage.target.kind !== 'all') {
      const clock = findClockTime(tokens, ctx.now, { ambiguousHours: 'morning' });
      if (clock !== null) {
        const minuteOfDay = clock.at.getHours() * 60 + clock.at.getMinutes();
        return { slots: { action: 'cancel', target: { kind: 'clock', minuteOfDay } }, score: 0.93 };
      }
    }
    return { slots: manage, score: manage.action === 'cancel' ? 0.93 : 0.9 };
  }

  const lead = leadingAlarm(text, tokens);
  if (lead === null) return matchAnswer(input, ctx);

  const options = { ambiguousHours: 'morning' } as const;
  const rest = tokens.slice(lead.from);
  const time =
    findScheduleTime(rest, ctx.now, options) ??
    findScheduleTime(tokens.slice(...lead.before), ctx.now, options);
  if (time === null) {
    if (!lead.explicit) return matchAnswer(input, ctx);
    const day = findDayWord(rest)?.word;
    return {
      slots: day === undefined ? { problem: 'missing-time' } : { problem: 'missing-time', day },
      score: 0.7,
    };
  }
  const score = lead.exact ? 0.95 : 0.91;
  return findRepetition(tokens).length > 0
    ? { slots: { at: time.at, repeating: true }, score }
    : { slots: { at: time.at }, score };
}

/** The answer to "What time should I set the alarm for?". */
function matchAnswer(input: NormalizedInput, ctx: ParseContext): CommandMatch<AlarmSlots> | null {
  const asked = pendingQuestion(ctx, 'alarm', 'alarm-time');
  if (asked === null) return null;
  const day = typeof asked.day === 'string' ? asked.day : undefined;
  const at = findAnsweredTime(input, ctx.now, day, { ambiguousHours: 'morning' });
  return at === null ? null : { slots: { at }, score: 0.6 };
}

function warn(ctx: RunContext, title: string, detail: string, speech: string): CommandResult {
  return {
    cards: [statusCard(ctx, { tone: 'warning', icon: 'alarm', title, detail })],
    speech,
    autoCloseMs: 5000,
  };
}

function setAlarm(slots: { at: number; repeating?: true }, ctx: RunContext): CommandResult {
  const now = ctx.now.getTime();
  if (slots.at <= now) {
    return warn(
      ctx,
      'That time has already passed',
      'Try a later time, or say "tomorrow at 7 am".',
      'That time has already passed. What time should I set the alarm for?',
    );
  }
  if (slots.at - now > MAX_ALARM_MS) {
    return warn(
      ctx,
      "That's too far away",
      'I can set alarms up to a year ahead.',
      'I can set alarms up to a year ahead.',
    );
  }

  const record = ctx.services.timers.schedule({ at: slots.at, label: 'Alarm', type: 'alarm' });
  const when = new Date(record.endsAt);
  const title = `Alarm set for ${formatClock(when, ctx.now)}`;
  const detail =
    slots.repeating === true
      ? `In ${formatDuration(record.endsAt - now)}. Repeating alarms are not supported yet, so it rings once.`
      : `In ${formatDuration(record.endsAt - now)}`;
  return {
    cards: [statusCard(ctx, { tone: 'success', icon: 'alarm', title, detail })],
    speech: title,
    autoCloseMs: 3500,
  };
}

export const alarmCommand = defineCommand<AlarmSlots>({
  id: 'alarm',
  number: 15,
  group: 'productivity',
  title: 'Alarms',
  icon: 'alarm',
  examples: [
    'set an alarm for 7 am',
    'wake me up at 6:30',
    'set an alarm for tomorrow at 8',
    'cancel my alarm',
  ],
  match: matchAlarm,
  run(slots, ctx) {
    if ('action' in slots) {
      return slots.action === 'list'
        ? listResult(ctx, ALARM_NOUN)
        : cancelResult(ctx, ALARM_NOUN, slots.target);
    }
    if ('problem' in slots) {
      return {
        cards: [
          statusCard(ctx, {
            tone: 'neutral',
            icon: 'alarm',
            title: 'What time should I set the alarm for?',
            detail: 'For example: "set an alarm for 7 am" or "wake me up at 6:30".',
          }),
        ],
        speech: 'What time should I set the alarm for?',
        pin: true,
        context: { awaiting: 'alarm-time', ...(slots.day === undefined ? {} : { day: slots.day }) },
      };
    }
    return setAlarm(slots, ctx);
  },
});

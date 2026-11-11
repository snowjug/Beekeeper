import type { CommandResult } from '@shared/cards';
import { matchLeadingVerb } from '../text';
import { formatDuration } from '../timeparse';
import {
  defineCommand,
  type CommandMatch,
  type NormalizedInput,
  type ParseContext,
  type RunContext,
} from '../types';
import {
  REMINDER_NOUN,
  atPhrase,
  cancelResult,
  isExactNoun,
  listResult,
  parseManage,
  type ManageIntent,
} from './scheduled';
import {
  capitalize,
  findAnsweredTime,
  findDayWord,
  findRepetition,
  findScheduleTime,
  lowerFirst,
  matchSetVerb,
  pendingQuestion,
  remainingText,
  statusCard,
} from './shared';

/** Reminders further out than this are refused. */
const MAX_REMINDER_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_LABEL_LENGTH = 200;

/** `day` remembers "tomorrow" from "remind me tomorrow to call mom" while the time is asked for. */
type ReminderSlots =
  | ManageIntent
  | { text: string; at: number; repeating?: true }
  | { problem: 'missing-text'; at: number | null; day?: string }
  | { problem: 'missing-time'; text: string; day?: string };

const SET_VERBS = ['set', 'create', 'add', 'make', 'schedule', 'new', 'put'];
const FILLERS: ReadonlySet<string> = new Set([
  'me',
  'a',
  'an',
  'the',
  'my',
  'new',
  'another',
  'quick',
  'one',
]);

/** "remind me ..." or "set a reminder ...": where the rest of the sentence starts. */
function leadingReminder(
  text: string,
  tokens: readonly string[],
): { from: number; exact: boolean; explicit: boolean } | null {
  const remind = matchLeadingVerb(text, ['remind']);
  if (remind !== null) {
    return tokens[1] === 'me' ? { from: 2, exact: remind.exact, explicit: true } : null;
  }

  const verb = matchSetVerb(text, SET_VERBS);
  let index = verb === null ? 0 : 1;
  while (FILLERS.has(tokens[index] ?? '')) index += 1;
  const noun = tokens[index] ?? '';
  if (!REMINDER_NOUN.singular.has(noun)) return null;
  return {
    from: index + 1,
    exact: (verb?.exact ?? true) && isExactNoun(REMINDER_NOUN, noun),
    explicit: verb !== null,
  };
}

/** Answers to "What should I remind you about?" / "When should I remind you?". */
function matchAnswer(
  input: NormalizedInput,
  ctx: ParseContext,
): CommandMatch<ReminderSlots> | null {
  const needsText = pendingQuestion(ctx, 'reminder', 'reminder-text');
  const asked = typeof needsText?.day === 'string' ? needsText.day : undefined;
  if (needsText !== null) {
    const answer = remainingText(input.raw, input.tokens, new Set());
    if (answer === '') return null;
    if (typeof needsText.at === 'number') {
      return { slots: { text: answer, at: needsText.at }, score: 0.5 };
    }
    return {
      slots:
        asked === undefined
          ? { problem: 'missing-time', text: answer }
          : { problem: 'missing-time', text: answer, day: asked },
      score: 0.5,
    };
  }

  const needsTime = pendingQuestion(ctx, 'reminder', 'reminder-time');
  if (needsTime !== null && typeof needsTime.text === 'string') {
    const day = typeof needsTime.day === 'string' ? needsTime.day : undefined;
    const at = findAnsweredTime(input, ctx.now, day);
    if (at !== null) return { slots: { text: needsTime.text, at }, score: 0.6 };
  }
  return null;
}

function matchReminder(
  input: NormalizedInput,
  ctx: ParseContext,
): CommandMatch<ReminderSlots> | null {
  const { text, tokens, raw } = input;
  if (text === '') return null;

  const manage = parseManage(text, REMINDER_NOUN);
  if (manage !== null) return { slots: manage, score: manage.action === 'cancel' ? 0.94 : 0.9 };

  const lead = leadingReminder(text, tokens);
  if (lead === null) return matchAnswer(input, ctx);

  const rest = tokens.slice(lead.from);
  const time = findScheduleTime(rest, ctx.now);
  const repeat = findRepetition(rest);
  const dayOnly = time === null ? findDayWord(rest) : null;
  const consumed = new Set([
    ...(time?.consumed ?? []),
    ...repeat,
    ...(dayOnly === null ? [] : [dayOnly.index]),
  ]);
  const content = remainingText(raw, rest, consumed);

  if (!lead.explicit && (time === null || content === '')) return matchAnswer(input, ctx);
  const day = dayOnly?.word;
  if (content === '') {
    return {
      slots:
        day === undefined
          ? { problem: 'missing-text', at: time?.at ?? null }
          : { problem: 'missing-text', at: null, day },
      score: 0.7,
    };
  }
  if (time === null) {
    return {
      slots:
        day === undefined
          ? { problem: 'missing-time', text: content }
          : { problem: 'missing-time', text: content, day },
      score: 0.7,
    };
  }
  const score = lead.exact ? 0.97 : 0.93;
  return repeat.length > 0
    ? { slots: { text: content, at: time.at, repeating: true }, score }
    : { slots: { text: content, at: time.at }, score };
}

/** "to call mom" for tasks, "about the meeting" for topics. */
function reminderSentence(text: string, at: Date, now: Date): string {
  const what = /^(?:about|that)\s/.test(text) ? text : `to ${lowerFirst(text)}`;
  return `I'll remind you ${atPhrase(at, now)} ${what}`;
}

function ask(slots: Extract<ReminderSlots, { problem: string }>, ctx: RunContext): CommandResult {
  const day = slots.day === undefined ? {} : { day: slots.day };
  if (slots.problem === 'missing-text') {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: 'bell',
          title: 'What should I remind you about?',
          detail: 'For example: "remind me in 10 minutes to call mom".',
        }),
      ],
      speech: 'What should I remind you about?',
      pin: true,
      context: { awaiting: 'reminder-text', at: slots.at, ...day },
    };
  }
  return {
    cards: [
      statusCard(ctx, {
        tone: 'neutral',
        icon: 'bell',
        title: 'When should I remind you?',
        detail: 'Try "in 10 minutes", "at 3:30 pm" or "tomorrow at 9am".',
      }),
    ],
    speech: 'When should I remind you?',
    pin: true,
    context: { awaiting: 'reminder-time', text: slots.text, ...day },
  };
}

function warn(ctx: RunContext, title: string, detail: string, speech: string): CommandResult {
  return {
    cards: [statusCard(ctx, { tone: 'warning', icon: 'bell', title, detail })],
    speech,
    autoCloseMs: 5000,
  };
}

function setReminder(
  slots: { text: string; at: number; repeating?: true },
  ctx: RunContext,
): CommandResult {
  const now = ctx.now.getTime();
  if (slots.at <= now) {
    return warn(
      ctx,
      'That time has already passed',
      'Try a later time, or say "tomorrow at 9am" or "in 10 minutes".',
      'That time has already passed. When should I remind you?',
    );
  }
  if (slots.at - now > MAX_REMINDER_MS) {
    return warn(
      ctx,
      "That's too far away",
      'I can set reminders up to a year ahead.',
      'I can set reminders up to a year ahead.',
    );
  }

  const label = capitalize(slots.text.replace(/^(?:about|that)\s+/, '')).slice(0, MAX_LABEL_LENGTH);
  const record = ctx.services.timers.schedule({ at: slots.at, label, type: 'reminder' });
  const sentence = reminderSentence(slots.text, new Date(record.endsAt), ctx.now);
  const detail =
    slots.repeating === true
      ? `In ${formatDuration(record.endsAt - now)}. I can only set one-time reminders for now.`
      : `In ${formatDuration(record.endsAt - now)}`;
  return {
    cards: [statusCard(ctx, { tone: 'success', icon: 'bell', title: sentence, detail })],
    speech: sentence,
    autoCloseMs: 3000,
  };
}

export const reminderCommand = defineCommand<ReminderSlots>({
  id: 'reminder',
  number: 14,
  group: 'productivity',
  title: 'Reminders',
  icon: 'bell',
  examples: [
    'remind me in 10 minutes to call mom',
    'remind me at 3:30 pm to submit the report',
    'remind me tomorrow at 9am to email john',
    'show my reminders',
  ],
  match: matchReminder,
  run(slots, ctx) {
    if ('action' in slots) {
      return slots.action === 'list'
        ? listResult(ctx, REMINDER_NOUN)
        : cancelResult(ctx, REMINDER_NOUN, slots.target);
    }
    if ('problem' in slots) return ask(slots, ctx);
    return setReminder(slots, ctx);
  },
});

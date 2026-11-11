import type { CommandResult } from '@shared/cards';
import { cleanForSpeech } from '@shared/speech/text';
import { statusCard } from '../lib/status';
import { matchPhrase } from '../text';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const PATTERNS: readonly RegExp[] = [
  /^(?:repeat|say|read)\s+(?:that|it|this)(?:\s+(?:again|back|out|out\s+loud|aloud|to\s+me))?$/,
  /^(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:repeat|say)\s+(?:that|it)\s+again$/,
  /^what\s+did\s+you\s+(?:just\s+)?say$/,
  /^(?:pardon|come\s+again)$/,
];

const PHRASES = ['repeat that', 'say that again', 'read that again', 'what did you say'];

/** The reply of one request is never read for longer than this. */
const MAX_SPOKEN_CHARS = 3000;

/** "Repeat that": speaks the last answer again (useful when the first time was missed). */
export const repeatCommand = defineCommand<NoSlots>({
  id: 'repeat',
  number: 41,
  group: 'assistant',
  title: 'Repeat',
  icon: 'volume',
  examples: ['Repeat that', 'Say that again', 'What did you say'],

  match(input) {
    if (PATTERNS.some((pattern) => pattern.test(input.text))) return { slots: {}, score: 0.92 };
    return matchPhrase(input.text, PHRASES) === null ? null : { slots: {}, score: 0.8 };
  },

  run(_slots, ctx): CommandResult {
    const last = ctx.services.ui.getLastAnswerText();
    const text = last ? cleanForSpeech(last).slice(0, MAX_SPOKEN_CHARS) : '';
    if (text === '') {
      return {
        cards: [
          statusCard(ctx, {
            tone: 'info',
            icon: 'info',
            title: 'Nothing to repeat yet',
            detail: 'Ask me something first.',
          }),
        ],
        speech: "I haven't said anything yet.",
      };
    }
    return {
      cards: [statusCard(ctx, { tone: 'info', icon: 'volume', title: 'Saying that again' })],
      speech: text,
    };
  },
});

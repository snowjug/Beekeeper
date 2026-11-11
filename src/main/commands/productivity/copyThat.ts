import type { CommandResult } from '@shared/cards';
import { matchLeadingVerb } from '../text';
import { defineCommand, type CommandMatch, type NormalizedInput } from '../types';
import { snippet, statusCard } from './shared';

type CopySlots = Record<string, never>;

/** What can be copied: the previous answer. */
const TARGET_WORDS: ReadonlySet<string> = new Set([
  'that',
  'this',
  'it',
  'answer',
  'result',
  'response',
  'reply',
  'text',
  'output',
  'clipboard',
]);
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'last',
  'latest',
  'previous',
  'recent',
  'whole',
  'entire',
  'full',
  'your',
  'my',
  'a',
  'to',
  'into',
  'again',
]);
const DEMONSTRATIVES: ReadonlySet<string> = new Set(['that', 'this', 'it']);
const PREVIEW_LENGTH = 100;

function matchCopy({ text }: NormalizedInput): CommandMatch<CopySlots> | null {
  const verb = matchLeadingVerb(text, ['copy']);
  if (verb === null) return null;
  const rest = verb.rest.split(' ').filter(Boolean);
  if (rest.length === 0) return { slots: {}, score: 0.7 };
  const allowed = rest.every((word) => TARGET_WORDS.has(word) || FILLER_WORDS.has(word));
  if (!allowed || !rest.some((word) => TARGET_WORDS.has(word))) return null;
  const plain = rest.length === 1 && DEMONSTRATIVES.has(rest[0] ?? '');
  return { slots: {}, score: plain ? 1 : 0.95 };
}

export const copyThatCommand = defineCommand<CopySlots>({
  id: 'copy-that',
  number: 17,
  group: 'productivity',
  title: 'Copy that',
  icon: 'copy',
  examples: ['copy that', 'copy the answer', 'copy last answer', 'copy it'],
  match: matchCopy,
  run(_slots, ctx): CommandResult {
    const { ui } = ctx.services;
    const answer = ui.getLastAnswerText();
    if (answer === null || answer.trim() === '') {
      return {
        cards: [
          statusCard(ctx, {
            tone: 'neutral',
            icon: 'copy',
            title: 'Nothing to copy yet',
            detail: 'Ask me something first, then say "copy that".',
          }),
        ],
        speech: 'There is nothing to copy yet.',
        autoCloseMs: 2500,
      };
    }
    try {
      ui.copyToClipboard(answer);
    } catch (error) {
      ctx.logger.warn('Copy to clipboard failed', error);
      return {
        cards: [
          statusCard(ctx, {
            tone: 'error',
            icon: 'error',
            title: "I couldn't copy that",
            detail: 'The clipboard is not available right now. Try again in a moment.',
          }),
        ],
        speech: "I couldn't copy that.",
        autoCloseMs: 4000,
      };
    }
    return {
      cards: [
        statusCard(ctx, {
          tone: 'success',
          icon: 'copy',
          title: 'Copied to clipboard',
          detail: snippet(answer, PREVIEW_LENGTH),
        }),
      ],
      speech: 'Copied to clipboard',
      autoCloseMs: 1200,
    };
  },
});

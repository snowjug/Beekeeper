import { correctTokens } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const VOCABULARY = ['dictate', 'dictation', 'dictating', 'voice', 'typing'];
const START = String.raw`(?:start|begin|open|launch|turn on|enable|activate|use|switch to|go to|enter|resume)`;
const PATTERNS: readonly RegExp[] = [
  // "dictate", "dictation", "start dictation", "start dictating", "dictation mode"
  new RegExp(
    String.raw`^(?:${START}\s+)?(?:the\s+|my\s+)?(?:voice\s+)?dictat(?:e|ion|ing)(?:\s+mode)?(?:\s+on)?$`,
  ),
  // "voice typing", "start voice typing", "voice typing mode"
  new RegExp(String.raw`^(?:${START}\s+)?(?:the\s+|my\s+)?voice\s+typing(?:\s+mode)?(?:\s+on)?$`),
  // "type what I say", "type as I speak", "type with my voice"
  /^type\s+(?:out\s+)?(?:what\s+(?:i\s+(?:say|said|speak)|i'?m\s+saying|i\s+am\s+saying)|(?:everything|whatever)\s+i\s+(?:say|speak)|as\s+i\s+(?:speak|talk|say)|(?:with|using|by)\s+(?:my\s+)?voice)$/,
  /^let\s+me\s+dictate$/,
];

/** "Start dictation": the dictation hotkey, by voice. The text goes into the app below the bar. */
export const dictateCommand = defineCommand<NoSlots>({
  id: 'dictate',
  number: 29,
  group: 'assistant',
  title: 'Dictation',
  icon: 'mic',
  examples: ['Start dictation', 'Dictate', 'Type what I say', 'Voice typing', 'Dictation mode'],
  // "start dictation" must beat "open <app>".
  priority: 10,

  match(input) {
    const fixed = correctTokens(input.tokens, VOCABULARY, (index) => index < 4);
    if (!PATTERNS.some((pattern) => pattern.test(fixed.tokens.join(' ')))) return null;
    return { slots: {}, score: fixed.corrected ? 0.85 : 0.97 };
  },

  run(_slots, ctx) {
    ctx.services.ui.startDictation();
    const card = statusCard(ctx, {
      tone: 'neutral',
      icon: 'mic',
      title: 'Dictation',
      detail: 'Speak and I will type it where your cursor is. Press the hotkey or Esc to stop.',
    });
    return { cards: [card], closeNow: true };
  },
});

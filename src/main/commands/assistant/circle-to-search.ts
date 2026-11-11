import { correctTokens } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const VOCABULARY = ['circle', 'search'];
const PATTERNS: readonly RegExp[] = [
  /^(?:(?:start|open|launch|run|activate|use|begin|trigger|turn on|fire up)\s+)?(?:the\s+)?circle(?:\s+to)?\s+search$/,
  /^circle\s+(?:this|that|it|something|(?:something\s+)?on\s+(?:my\s+|the\s+)?screen|the screen|my screen)$/,
  /^(?:search|scan|read|look at)\s+(?:(?:on|what's on)\s+)?(?:my|the|this)\s+(?:screen|display|monitor)$/,
  /^what(?:'s| is)\s+on\s+(?:my|the)\s+(?:screen|display|monitor)$/,
];

export const circleToSearchCommand = defineCommand<NoSlots>({
  id: 'circle-to-search',
  number: 26,
  group: 'assistant',
  title: 'Circle to Search',
  icon: 'circle',
  examples: ['Circle to Search', 'Circle this', 'Search my screen', "What's on my screen?"],
  // "search my screen" must beat the generic web search.
  priority: 10,

  match(input) {
    const fixed = correctTokens(input.tokens, VOCABULARY, (index) => index < 4);
    if (!PATTERNS.some((pattern) => pattern.test(fixed.tokens.join(' ')))) return null;
    return { slots: {}, score: fixed.corrected ? 0.85 : 0.97 };
  },

  run(_slots, ctx) {
    ctx.services.ui.openCircleToSearch();
    const card = statusCard(ctx, {
      tone: 'neutral',
      icon: 'circle',
      title: 'Circle to Search',
      detail: 'Circle, scribble or tap anything on your screen.',
    });
    return { cards: [card], closeNow: true };
  },
});

import type { CommandResult } from '@shared/cards';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const STOP_WORDS =
  /^(?:stop|cancel|never ?mind|nvm|forget (?:it|that|about it)|be quiet|quiet|silence|hush|shush|enough|that'?s (?:all|enough)|that will be all|that'?ll be all|dismiss|close)(?:\s+(?:that|it|this|now|listening|talking|speaking|everything))?$/;

export const stopCommand = defineCommand<NoSlots>({
  id: 'stop',
  number: 28,
  group: 'assistant',
  title: 'Stop',
  icon: 'stop',
  examples: ['Stop', 'Never mind', 'Cancel', 'Be quiet'],
  // A bare "close" must beat the close-app matcher.
  priority: 10,

  match(input) {
    return STOP_WORDS.test(input.text) ? { slots: {}, score: 0.98 } : null;
  },

  run(_slots, ctx): CommandResult {
    ctx.services.ui.stopSpeaking();
    ctx.services.ui.cancelPending();
    return { cards: [], closeNow: true };
  },
});

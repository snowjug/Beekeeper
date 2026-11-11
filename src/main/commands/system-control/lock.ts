import { failureResult, statusCard } from '../apps-web/cards';
import { matchLeadingVerb, stripArticles } from '../text';
import { defineCommand } from '../types';

type NoSlots = Record<string, never>;

const TARGETS: ReadonlySet<string> = new Set([
  'pc',
  'computer',
  'laptop',
  'machine',
  'screen',
  'workstation',
  'windows',
  'system',
  'device',
  'desktop',
  'notebook',
  'tablet',
  'session',
]);

export const lockCommand = defineCommand<NoSlots>({
  id: 'lock',
  number: 21,
  group: 'system',
  title: 'Lock the PC',
  icon: 'lock',
  examples: [
    'Lock my PC',
    'Lock the computer',
    'Lock screen',
    'Lock workstation',
    'Lock my laptop',
  ],

  match(input) {
    const verb = matchLeadingVerb(input.text, ['lock']);
    if (verb === null) return null;
    const target = stripArticles(verb.rest.replace(/\s+now$/, ''))
      .replace(/^(?:this|your)\s+/, '')
      .trim();
    if (target === '') return verb.exact ? { slots: {}, score: 0.8 } : null;
    if (!TARGETS.has(target)) return null;
    return { slots: {}, score: verb.exact ? 0.95 : 0.85 };
  },

  async run(_slots, ctx) {
    try {
      await ctx.services.system.lockWorkstation();
    } catch (error) {
      return failureResult(ctx, 'lock your PC', error);
    }
    const card = statusCard(ctx, { tone: 'success', icon: 'lock', title: 'Locking your PC' });
    return { cards: [card], speech: 'Locking your PC.', autoCloseMs: 1000 };
  },
});

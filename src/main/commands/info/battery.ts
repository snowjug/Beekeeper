import type { BatteryCard, CommandResult } from '@shared/cards';
import type { BatteryInfo } from '../../system/types';
import { describeDuration } from '../lib/durations';
import { correctTokens } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { defineCommand } from '../types';
import type { RunContext } from '../types';

interface BatterySlots {
  /** "is my laptop charging" asks about charging, everything else about the level. */
  focus: 'level' | 'charging';
}

const VOCABULARY = ['battery', 'batteries', 'charging', 'percentage'];
const KEYWORDS = new Set(['battery', 'batteries', 'charging', 'plugged']);
/** "how much charge / power is left" has no "battery" in it. */
const CHARGE_WORDS = new Set(['charge', 'power', 'juice']);
const CHARGE_CONTEXT = new Set(['left', 'remaining', 'much']);
const ALLOWED = new Set([
  ...KEYWORDS,
  ...CHARGE_WORDS,
  ...CHARGE_CONTEXT,
  'what',
  'how',
  'is',
  'are',
  'am',
  'my',
  'the',
  'a',
  'laptop',
  'pc',
  'computer',
  'device',
  'machine',
  'do',
  'i',
  'have',
  'level',
  'status',
  'percentage',
  'percent',
  'life',
  'health',
  'state',
  'show',
  'check',
  'tell',
  'me',
  'give',
  'get',
  'current',
  'of',
  'it',
  'still',
  'now',
  'in',
  'on',
  'at',
  'low',
  'full',
  'charged',
  'doing',
  'info',
]);

function parse(text: string): { slots: BatterySlots; corrected: boolean } | null {
  const spaced = text.replace(/\b(what|how|it)'?s\b/g, '$1');
  const fixed = correctTokens(spaced.split(' '), VOCABULARY);
  const { tokens } = fixed;
  if (!tokens.every((token) => ALLOWED.has(token))) return null;

  const mentionsBattery = tokens.some((token) => KEYWORDS.has(token));
  const asksCharge =
    tokens.some((token) => CHARGE_WORDS.has(token)) &&
    tokens.some((token) => CHARGE_CONTEXT.has(token));
  if (!mentionsBattery && !asksCharge) return null;

  const focus = tokens.includes('charging') || tokens.includes('plugged') ? 'charging' : 'level';
  return { slots: { focus }, corrected: fixed.corrected };
}

function failure(ctx: RunContext): CommandResult {
  const card = statusCard(ctx, {
    tone: 'error',
    icon: 'battery',
    title: "I couldn't read the battery status",
    detail: 'Windows did not answer. Please try again.',
  });
  return { cards: [card], speech: "Sorry, I couldn't read the battery status." };
}

export const batteryCommand = defineCommand<BatterySlots>({
  id: 'battery',
  number: 8,
  group: 'info',
  title: 'Battery',
  icon: 'battery',
  examples: ['Battery status', 'How much battery do I have?', 'Is my laptop charging?'],

  match(input) {
    const parsed = parse(input.text);
    return parsed ? { slots: parsed.slots, score: parsed.corrected ? 0.85 : 0.95 } : null;
  },

  async run(slots, ctx) {
    let battery: BatteryInfo;
    try {
      battery = await ctx.services.system.getBattery();
    } catch (error) {
      ctx.logger.warn('Could not read the battery status:', error);
      return failure(ctx);
    }

    const { hasBattery, percent, charging, onAc, minutesRemaining } = battery;
    const card: BatteryCard = {
      kind: 'battery',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      hasBattery,
      charging,
      onAc,
    };
    if (percent !== undefined) card.percent = percent;
    if (minutesRemaining !== undefined) card.minutesRemaining = minutesRemaining;

    if (!hasBattery || percent === undefined) {
      card.copyText = "This PC doesn't have a battery";
      return {
        cards: [card],
        speech: "This PC doesn't have a battery. It's running on AC power.",
      };
    }

    const state = charging ? 'charging' : onAc ? 'plugged in' : 'on battery';
    card.copyText = `Battery: ${percent}% (${state})`;

    let speech: string;
    if (slots.focus === 'charging') {
      if (charging) speech = `Yes, your battery is charging. It's at ${percent} percent.`;
      else if (onAc)
        speech = `No, it's plugged in but not charging. The battery is at ${percent} percent.`;
      else speech = `No, your PC is running on battery power at ${percent} percent.`;
    } else {
      const status = charging ? ' and charging' : onAc ? ' and plugged in' : '';
      const left =
        !onAc && minutesRemaining !== undefined && minutesRemaining > 0
          ? `, about ${describeDuration(minutesRemaining * 60)} left`
          : '';
      speech = `Your battery is at ${percent} percent${status}${left}.`;
    }
    return { cards: [card], speech };
  },
});

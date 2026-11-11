import type { ConversionCard, StatusCard } from '@shared/cards';
import { fuzzyWord } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { convertUnits, formatQuantity, getUnit, parseConversion } from '../lib/units';
import type { UnitDef } from '../lib/units';
import { defineCommand } from '../types';
import type { RunContext } from '../types';

export interface ConvertSlots {
  value: number;
  /** Unit ids from lib/units. */
  from: string;
  to: string;
}

const CATEGORY_NAMES: Record<UnitDef['category'], string> = {
  length: 'length',
  weight: 'weight',
  temperature: 'temperature',
  data: 'data size',
};

function warning(ctx: RunContext, title: string, detail?: string): StatusCard {
  return statusCard(ctx, { tone: 'warning', icon: 'convert', title, detail });
}

export const convertCommand = defineCommand<ConvertSlots>({
  id: 'convert',
  number: 11,
  group: 'info',
  title: 'Unit converter',
  icon: 'convert',
  examples: [
    'Convert 5 km to miles',
    '10 pounds in kg',
    'How many feet in a mile?',
    '100°F to celsius',
  ],

  match(input) {
    let text = input.text;
    let corrected = false;
    const [first = '', ...rest] = input.tokens;
    if (first !== 'convert' && fuzzyWord(first, 'convert')) {
      text = ['convert', ...rest].join(' ');
      corrected = true;
    }

    const request = parseConversion(text);
    if (!request) return null;
    return {
      slots: { value: request.value, from: request.from.id, to: request.to.id },
      score: corrected || !request.exact ? 0.85 : 0.95,
    };
  },

  run(slots, ctx) {
    const from = getUnit(slots.from);
    const to = getUnit(slots.to);
    if (!from || !to) throw new Error(`Unknown unit "${from ? slots.to : slots.from}"`);

    const outcome = convertUnits(slots.value, from, to);
    if (outcome.status === 'incompatible') {
      const title = `I can't convert ${from.plural} to ${to.plural}`;
      const detail = `${from.plural} measure ${CATEGORY_NAMES[from.category]}, while ${to.plural} measure ${CATEGORY_NAMES[to.category]}.`;
      return { cards: [warning(ctx, title, detail)], speech: `${title}. ${detail}` };
    }
    if (outcome.status === 'below-absolute-zero') {
      const title = "That's below absolute zero";
      const detail = 'Nothing can be colder than 0 kelvin (−273.15°C).';
      return { cards: [warning(ctx, title, detail)], speech: `${title}.` };
    }

    const fromText = formatQuantity(slots.value, from, { fractionDigits: 6 });
    const toText = formatQuantity(outcome.value, to);
    const card: ConversionCard = {
      kind: 'conversion',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      category: from.category,
      fromText,
      toText,
      copyText: toText,
    };
    const speech = `${formatQuantity(slots.value, from, { fractionDigits: 6, spoken: true })} is ${formatQuantity(outcome.value, to, { spoken: true })}.`;
    return { cards: [card], speech };
  },
});

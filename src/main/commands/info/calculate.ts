import type { CalculationCard, StatusCard } from '@shared/cards';
import { evaluateMath } from '../lib/math';
import type { MathFailure } from '../lib/math';
import { formatValue } from '../lib/numbers';
import { statusCard } from '../lib/status';
import { matchLeadingVerb } from '../text';
import { defineCommand } from '../types';
import type { RunContext } from '../types';

interface CalculateSlots {
  /** The expression to evaluate, e.g. "15% of 2400" or "2 plus 2 times 3". */
  source: string;
}

/** Long verbs tolerate typos ("calcualte"); the short ones must be exact. */
const FUZZY_VERBS = ['calculate', 'compute', 'evaluate'];
const EXACT_VERB = /^(?:calc|solve|work out|figure out)\s+(?<rest>.+)$/;
const QUESTION_PREFIX =
  /^(?:what is|what's|whats|what are|how much is|how much are|what does)\s+(?<rest>.+)$/;
const FILLER_PREFIX = /^(?:the\s+)?(?:(?:result|answer|value|sum|product) of\s+|answer to\s+)?/;
const TRAILING_EQUALS = /\s*(?:=|equals?)$/;
const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}$/;

const SPOKEN_FUNCTIONS: ReadonlyArray<readonly [name: string, spoken: string]> = [
  ['sqrt', 'the square root of '],
  ['cbrt', 'the cube root of '],
  ['abs', 'the absolute value of '],
  ['round', 'round '],
  ['floor', 'floor '],
  ['ceil', 'ceiling '],
  ['sin', 'sine of '],
  ['cos', 'cosine of '],
  ['tan', 'tangent of '],
  ['log', 'log of '],
  ['ln', 'the natural log of '],
];

/** Reads an expression aloud: "15% × 2400" becomes "15 percent times 2400". */
function speakExpression(expression: string): string {
  let spoken = expression;
  for (const [name, words] of SPOKEN_FUNCTIONS) {
    spoken = spoken.replace(new RegExp(`\\b${name}\\(`, 'g'), `${words}(`);
  }
  return spoken
    .replace(/ × /g, ' times ')
    .replace(/ ÷ /g, ' divided by ')
    .replace(/ − /g, ' minus ')
    .replace(/−/g, 'minus ')
    .replace(/ \+ /g, ' plus ')
    .replace(/\^/g, ' to the power of ')
    .replace(/%/g, ' percent')
    .replace(/²/g, ' squared')
    .replace(/³/g, ' cubed')
    .replace(/°/g, ' degrees')
    .replace(/π/g, 'pi')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateFor(text: string): { source: string; score: number; explicit: boolean } | null {
  const body = (rest: string): string =>
    rest.replace(FILLER_PREFIX, '').replace(TRAILING_EQUALS, '');

  const fuzzy = matchLeadingVerb(text, FUZZY_VERBS);
  if (fuzzy) return { source: body(fuzzy.rest), score: fuzzy.exact ? 0.95 : 0.85, explicit: true };

  const exact = EXACT_VERB.exec(text)?.groups?.['rest'];
  if (exact !== undefined) return { source: body(exact), score: 0.95, explicit: true };

  const question = QUESTION_PREFIX.exec(text)?.groups?.['rest'];
  return question === undefined ? null : { source: body(question), score: 0.95, explicit: false };
}

function failure(reason: MathFailure): { title: string; speech: string } {
  switch (reason) {
    case 'division-by-zero':
      return { title: "I can't divide by zero", speech: "I can't divide by zero." };
    case 'domain':
      return {
        title: "That doesn't have a real answer",
        speech: "That doesn't have a real answer.",
      };
    case 'overflow':
      return {
        title: 'That number is too large',
        speech: 'That number is too large for me to work out.',
      };
  }
}

function warning(ctx: RunContext, title: string, detail?: string): StatusCard {
  return statusCard(ctx, { tone: 'warning', icon: 'calculator', title, detail });
}

export const calculateCommand = defineCommand<CalculateSlots>({
  id: 'calculate',
  number: 10,
  group: 'info',
  title: 'Calculator',
  icon: 'calculator',
  examples: ['Calculate 15% of 2400', "What's 12 times 8?", 'Square root of 144', '2^8'],

  match(input) {
    const text = input.text.replace(TRAILING_EQUALS, '');
    const prefixed = candidateFor(text);
    if (prefixed) {
      const outcome = evaluateMath(prefixed.source);
      if (outcome.status === 'syntax-error') {
        // "calculate 2 +" is a calculation gone wrong and gets an explanation, while
        // "calculate the tip" or "what is the weather" are not maths and belong to others.
        return prefixed.explicit && !outcome.unrecognized
          ? { slots: { source: prefixed.source }, score: 0.7 }
          : null;
      }
      // Only an explicit verb ("calculate 5") makes a lone number worth answering.
      if (!prefixed.explicit && outcome.kind === 'literal') return null;
      return { slots: { source: prefixed.source }, score: prefixed.score };
    }

    if (DATE_LIKE.test(text)) return null;
    const outcome = evaluateMath(text);
    return outcome.status !== 'syntax-error' && outcome.kind === 'operation'
      ? { slots: { source: text }, score: 0.9 }
      : null;
  },

  run(slots, ctx) {
    const outcome = evaluateMath(slots.source);
    if (outcome.status === 'syntax-error') {
      const title = "I couldn't understand that calculation";
      const card = warning(ctx, title, 'Try something like "calculate 15% of 2400".');
      return {
        cards: [card],
        speech: `${title}. Try something like calculate 15 percent of 2400.`,
      };
    }
    if (outcome.status === 'failed') {
      const { title, speech } = failure(outcome.reason);
      return { cards: [warning(ctx, title, outcome.expression)], speech };
    }

    const resultText = formatValue(outcome.value);
    const card: CalculationCard = {
      kind: 'calc',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      expression: outcome.expression,
      resultText,
      value: outcome.value,
      copyText: resultText.replace(/,/g, ''),
    };
    return { cards: [card], speech: `${speakExpression(outcome.expression)} is ${resultText}.` };
  },
});

import type { CommandResult, DefinitionCard, StatusCard } from '@shared/cards';
import { correctTokens } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { defineCommand } from '../types';
import type { DictionaryService, RunContext } from '../types';

interface DefineSlots {
  word: string;
}

/** Structure words a typo may be repaired into (never the word being looked up). */
const VOCABULARY = [
  'define',
  'definition',
  'meaning',
  'dictionary',
  'what',
  "what's",
  'whats',
  'does',
  'mean',
  'lookup',
];
/** Pronouns and the like: "what does that mean" is a follow-up we cannot resolve. */
const NOT_WORDS = new Set([
  'it',
  'this',
  'that',
  'these',
  'those',
  'there',
  'here',
  'what',
  'which',
]);
const MAX_WORDS = 3;
const MAX_SPOKEN_LENGTH = 300;

const WHAT_IS = String.raw`(?:what(?:'s| is)|whats)`;
const LEAD = String.raw`(?:(?:give me|tell me|show me|get|find|i need|need)\s+)?`;
const QUALIFIER = String.raw`(?:the\s+)?(?:(?:word|term|phrase)\s+)?`;
const WORD = String.raw`(?<word>[a-z][a-z' -]*)`;

const PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`^(?:define|defining)\s+${QUALIFIER}${WORD}$`),
  new RegExp(String.raw`^what does\s+${QUALIFIER}${WORD}\s+mean$`),
  new RegExp(String.raw`^${WHAT_IS}\s+${QUALIFIER}${WORD}\s+mean$`),
  new RegExp(
    String.raw`^(?:${WHAT_IS}\s+)?${LEAD}(?:the\s+)?(?:definition|meaning)\s+(?:of|for)\s+${QUALIFIER}${WORD}$`,
  ),
  new RegExp(
    String.raw`^dictionary(?:\s+(?:lookup|look up|definition|search))?(?:\s+(?:for|of))?\s+${QUALIFIER}${WORD}$`,
  ),
  new RegExp(String.raw`^(?:look up|lookup)\s+${QUALIFIER}${WORD}\s+in\s+(?:the\s+)?dictionary$`),
  new RegExp(
    String.raw`^(?:look up|lookup)\s+(?:the\s+)?(?:definition|meaning)\s+(?:of|for)\s+${QUALIFIER}${WORD}$`,
  ),
];

function extractWord(text: string): string | null {
  for (const pattern of PATTERNS) {
    const word = pattern.exec(text)?.groups?.['word']?.trim();
    if (word === undefined) continue;
    const parts = word.split(/\s+/);
    if (parts.length > MAX_WORDS || parts.some((part) => NOT_WORDS.has(part))) return null;
    return word.length <= 40 ? word : null;
  }
  return null;
}

function status(
  ctx: RunContext,
  tone: StatusCard['tone'],
  title: string,
  detail: string,
): StatusCard {
  return statusCard(ctx, { tone, icon: 'book', title, detail });
}

function spoken(word: string, partOfSpeech: string, definition: string): string {
  const text = `${word}, ${partOfSpeech}. ${definition}`;
  if (text.length <= MAX_SPOKEN_LENGTH) return text;
  return `${text.slice(0, MAX_SPOKEN_LENGTH).replace(/\s+\S*$/, '')}…`;
}

export const dictionaryCommand = defineCommand<DefineSlots>({
  id: 'define',
  number: 12,
  group: 'info',
  title: 'Dictionary',
  icon: 'book',
  examples: ['Define serendipity', 'What does ephemeral mean?', 'Meaning of resilient'],

  match(input) {
    const fixed = correctTokens(
      input.tokens,
      VOCABULARY,
      (index, count) => index < 4 || index === count - 1,
    );
    const word = extractWord(fixed.tokens.join(' '));
    return word === null ? null : { slots: { word }, score: fixed.corrected ? 0.85 : 0.95 };
  },

  async run(slots, ctx) {
    let found: Awaited<ReturnType<DictionaryService['define']>>;
    try {
      found = await ctx.services.dictionary.define(slots.word);
    } catch (error) {
      ctx.logger.warn('Dictionary lookup failed:', error);
      const title = "I couldn't reach the dictionary";
      const detail = 'Check your connection and try again.';
      return { cards: [status(ctx, 'error', title, detail)], speech: `${title}. ${detail}` };
    }

    if (found === null) {
      const title = `I couldn't find "${slots.word}"`;
      return {
        cards: [status(ctx, 'warning', title, 'Check the spelling or try another word.')],
        speech: `I couldn't find a definition for ${slots.word}.`,
      };
    }

    const meanings = found.meanings.slice(0, 3);
    const first = meanings[0];
    const lead = first?.definitions[0]?.definition ?? '';
    const copyText = [
      found.phonetic ? `${found.word} ${found.phonetic}` : found.word,
      ...meanings.map((meaning) => {
        const definition = meaning.definitions[0]?.definition ?? '';
        return `${meaning.partOfSpeech}: ${definition}`;
      }),
    ].join('\n');

    const card: DefinitionCard = {
      ...found,
      meanings,
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      copyText,
    };
    if (found.sourceUrl) card.openUrl = found.sourceUrl;

    const result: CommandResult = { cards: [card] };
    if (first && lead.length > 0) result.speech = spoken(found.word, first.partOfSpeech, lead);
    return result;
  },
});

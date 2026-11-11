import { findNumber } from '../text';
import { correctTokens } from '../lib/fuzzy';

type Direction = 'up' | 'down';

/** What the user wants done with a 0-100 level such as the volume or the brightness. */
export type LevelAction =
  | { action: 'step'; direction: Direction; amount: number }
  | { action: 'set'; percent: number }
  | { action: 'get' };

export interface ParsedLevel {
  slots: LevelAction;
  score: number;
}

export interface LevelVocabulary {
  /** Regex source (no anchors) for the thing being adjusted: "volume(?:\\s+level)?". */
  noun: string;
  /** Plain words of the thing being adjusted; a near-miss ("volum") is read as the word. */
  typoWords?: readonly string[];
  /** Words that mean a direction on their own ("louder" -> up). */
  comparatives: Readonly<Record<string, Direction>>;
  /** Regex source for objects of "make/turn ... <comparative>" besides it/this/that, or null. */
  objects: string | null;
  /** Verbs that carry the direction themselves ("dim" -> down). */
  impliedVerbs: Readonly<Record<string, Direction>>;
  /** Accept "turn it up / down". */
  pronounTurn: boolean;
  /** "loud" for "how loud is it", "bright" for "how bright is it". */
  how: string;
}

/** Points a plain "volume up" / "brightness down" moves the level. */
const DEFAULT_STEP = 10;

const ART = String.raw`(?:(?:the|my|our)\s+)?`;
const SOFTENER = String.raw`(?:\s+(?:a\s+(?:little\s+)?(?:bit|little|lot)|slightly|some|a\s+notch|more))?`;
/** "by 20", "20", "by 20 percent": the number was replaced by # before matching. */
const AMOUNT = String.raw`(?:\s+(?:by\s+)?#(?:\s+(?:percent|points?))?)?`;
const SET_VERB = String.raw`(?:(?:set|change|adjust|make|put|bring|turn)\s+)?`;
const NAMED = 'max|maximum|full|half|min|minimum|lowest|highest|zero';
const NAMED_LEVELS: Readonly<Record<string, number>> = {
  max: 100,
  maximum: 100,
  full: 100,
  highest: 100,
  half: 50,
  min: 0,
  minimum: 0,
  lowest: 0,
  zero: 0,
};
const UP_WORDS: ReadonlySet<string> = new Set(['up', 'higher', 'increase', 'raise', 'boost']);

interface PreparedText {
  text: string;
  value: number | null;
}

/** Replaces the one number in the text by "#" ("volume to fifty percent" -> "volume to # percent"). */
function prepare(text: string): PreparedText | null {
  const tokens = text
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/%/g, ' percent ')
    .split(/\s+/)
    .filter((token) => token !== '');
  const found = findNumber(tokens);
  if (found === null) return { text: tokens.join(' '), value: null };
  const rest = [...tokens.slice(0, found.start), '#', ...tokens.slice(found.end)];
  // Two numbers ("volume 40 50") are ambiguous.
  return findNumber(rest) === null ? { text: rest.join(' '), value: found.value } : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function direction(word: string, vocabulary: LevelVocabulary): Direction {
  return vocabulary.comparatives[word] ?? (UP_WORDS.has(word) ? 'up' : 'down');
}

/**
 * Builds a strict matcher for sentences about one 0-100 level. Every word must belong to the
 * grammar, so "what is the volume of a sphere with radius 3" is never mistaken for a volume command.
 */
export function createLevelParser(
  vocabulary: LevelVocabulary,
): (text: string) => ParsedLevel | null {
  const noun = `${ART}${vocabulary.noun}`;
  const comparativeWords = Object.keys(vocabulary.comparatives).join('|');
  const objects = ['it|this|that', vocabulary.objects].filter((part) => part !== null).join('|');
  const impliedWords = Object.keys(vocabulary.impliedVerbs).join('|');
  const typoWords = vocabulary.typoWords ?? [];

  const setNumber = new RegExp(
    String.raw`^${SET_VERB}${noun}(?:\s+(?:to|at))?\s+#(?:\s+percent)?$|^(?:turn|bring|crank)\s+${noun}\s+(?:up|down)\s+to\s+#(?:\s+percent)?$`,
  );
  const setNamed = new RegExp(
    String.raw`^${SET_VERB}${noun}\s+(?:to|at)\s+(?<named>${NAMED})$|^(?<named2>${NAMED})\s+${noun}$`,
  );
  const step = new RegExp(
    String.raw`^(?:(?:turn|crank|bump|pump|bring|take)\s+(?<d1>up|down)\s+${noun}|(?<d2>increase|raise|boost|lower|decrease|reduce|drop|lessen)\s+${noun}|(?:(?:turn|crank|bump|pump|bring|take|make|set)\s+)?${noun}\s+(?<d3>up|down|higher|lower|${comparativeWords}))${SOFTENER}${AMOUNT}$`,
  );
  const comparative = new RegExp(
    String.raw`^(?:(?:make|turn|get)\s+(?:${objects})\s+)?(?:(?:a\s+(?:little\s+)?(?:bit|little)|much|slightly|way)\s+)?(?<c>${comparativeWords})$`,
  );
  const pronounTurn = vocabulary.pronounTurn
    ? new RegExp(
        String.raw`^(?:turn|crank|bump|bring|take|pump)\s+(?:it|this|that)\s+(?<d>up|down)${SOFTENER}${AMOUNT}$`,
      )
    : null;
  const implied =
    impliedWords === ''
      ? null
      : new RegExp(String.raw`^(?<v>${impliedWords})(?:\s+(?:${objects}))?${SOFTENER}${AMOUNT}$`);
  const query = new RegExp(
    String.raw`^(?<lead>(?:what(?:'s|s)?|what\s+is|how\s+${vocabulary.how}\s+is|tell\s+me|show\s+me|check|get|read\s+out)\s+)?${ART}(?<current>current\s+)?${noun}(?:\s+(?:level|setting))?(?:\s+(?:right\s+)?(?:now|currently|at|set\s+to))?$`,
  );

  const parse = (text: string): ParsedLevel | null => {
    const prepared = prepare(text);
    if (prepared === null) return null;
    const { text: shaped, value } = prepared;
    const amount = clampPercent(value ?? DEFAULT_STEP) || 1;

    if (value !== null && setNumber.test(shaped)) {
      return { slots: { action: 'set', percent: clampPercent(value) }, score: 0.95 };
    }
    const named = setNamed.exec(shaped)?.groups;
    const level = named?.['named'] ?? named?.['named2'];
    if (level !== undefined) {
      return { slots: { action: 'set', percent: NAMED_LEVELS[level] ?? 0 }, score: 0.95 };
    }

    const stepped = step.exec(shaped)?.groups;
    const word = stepped?.['d1'] ?? stepped?.['d2'] ?? stepped?.['d3'];
    if (word !== undefined) {
      return {
        slots: { action: 'step', direction: direction(word, vocabulary), amount },
        score: 0.95,
      };
    }

    const turned = pronounTurn?.exec(shaped)?.groups?.['d'];
    if (turned !== undefined) {
      return {
        slots: { action: 'step', direction: direction(turned, vocabulary), amount },
        score: 0.92,
      };
    }
    const compared = comparative.exec(shaped)?.groups?.['c'];
    if (compared !== undefined) {
      return {
        slots: { action: 'step', direction: direction(compared, vocabulary), amount },
        score: 0.92,
      };
    }
    const verb = implied?.exec(shaped)?.groups?.['v'];
    if (verb !== undefined) {
      const implication = vocabulary.impliedVerbs[verb] ?? 'down';
      return { slots: { action: 'step', direction: implication, amount }, score: 0.92 };
    }

    const asked = query.exec(shaped)?.groups;
    if (asked !== undefined) {
      const explicit = asked['lead'] !== undefined || asked['current'] !== undefined;
      return { slots: { action: 'get' }, score: explicit ? 0.9 : 0.7 };
    }
    return null;
  };

  return (text) => {
    const exact = parse(text);
    if (exact !== null || typoWords.length === 0) return exact;
    // A misspelt noun still counts, but a little less than the exact spelling.
    const fixed = correctTokens(text.split(/\s+/), typoWords);
    if (!fixed.corrected) return null;
    const repaired = parse(fixed.tokens.join(' '));
    return repaired === null ? null : { ...repaired, score: Math.min(repaired.score, 0.85) };
  };
}

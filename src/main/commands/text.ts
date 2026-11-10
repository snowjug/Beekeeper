import type { NormalizedInput } from './types';

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const WAKE_PREFIX = /^(?:(?:hey|ok|okay|hi|hello|yo)[\s,]+)?bee[\s-]?keepers?\b[\s,:.!-]*/;
const LEADING_FILLERS: readonly RegExp[] = [
  /^(?:please|pls|kindly|just|um+|uh+|hmm+|er+|so|well|okay|ok|and)\b[\s,]*/,
  /^(?:can|could|would|will) you(?: please)?\b[\s,]*/,
  /^i(?:'d| would| will| want| need|'ll)(?: like)?(?: you)? to\b[\s,]*/,
  /^i want\b(?= (?:the|a|an|you)\b)[\s,]*/,
  /^(?:go ahead and|try to|let's|let us)\b[\s,]*/,
];
const TRAILING_FILLERS = /[\s,]*\b(?:please|pls|for me|thanks|thank you|right now)$/;

/** Lower-cases and strips wake phrases, politeness fillers and trailing punctuation. */
export function normalizeInput(raw: string): NormalizedInput {
  let text = raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(WAKE_PREFIX, '');
  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    for (const filler of LEADING_FILLERS) text = text.replace(filler, '');
    if (text === before) break;
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = text.replace(TRAILING_FILLERS, '').replace(/[\s?!.,;:]+$/, '');
    if (text === before) break;
  }
  text = text.replace(/\s+/g, ' ').trim();

  return { raw, text, tokens: text.length === 0 ? [] : text.split(' ') };
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Edit distance (optimal string alignment: insert, delete, substitute, swap adjacent letters).
 * Returns max + 1 early when the distance exceeds `max`.
 */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** 0..1 similarity based on edit distance. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/** Typo budget for matching a whole phrase of the given length. */
export function typoBudget(length: number): number {
  if (length < 5) return 0;
  return Math.min(3, Math.floor(length / 5));
}

/** True when `text` equals `phrase`, allowing a length-dependent number of typos. */
export function fuzzyEquals(text: string, phrase: string): boolean {
  if (text === phrase) return true;
  return levenshtein(text, phrase, typoBudget(phrase.length)) <= typoBudget(phrase.length);
}

/** Best matching phrase for the whole text, or null. Exact matches win. */
export function matchPhrase(text: string, phrases: readonly string[]): string | null {
  if (phrases.includes(text)) return text;
  for (const phrase of phrases) {
    if (fuzzyEquals(text, phrase)) return phrase;
  }
  return null;
}

export interface LeadingVerbMatch {
  /** The verb from `verbs` that matched (not what the user typed). */
  verb: string;
  /** Text after the verb. May be empty. */
  rest: string;
  /** False when the verb matched only through typo tolerance. */
  exact: boolean;
}

function verbTolerance(verb: string): number {
  if (verb.length >= 8) return 2;
  if (verb.length >= 4) return 1;
  return 0;
}

/**
 * Matches one of `verbs` at the start of `text`. Multi-word verbs ("fire up") are
 * supported. Single-word verbs of 4+ letters tolerate typos as long as the first
 * letter is right ("opne" -> "open").
 */
export function matchLeadingVerb(text: string, verbs: readonly string[]): LeadingVerbMatch | null {
  const tokens = text.length === 0 ? [] : text.split(' ');
  const ordered = [...verbs].sort(
    (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length,
  );

  for (const verb of ordered) {
    const words = verb.split(' ').length;
    if (tokens.length < words) continue;
    const head = tokens.slice(0, words).join(' ');
    if (head === verb) return { verb, rest: tokens.slice(words).join(' '), exact: true };
  }
  for (const verb of ordered) {
    if (verb.includes(' ')) continue;
    const first = tokens[0];
    if (first === undefined || first[0] !== verb[0]) continue;
    const tolerance = verbTolerance(verb);
    if (tolerance > 0 && levenshtein(first, verb, tolerance) <= tolerance) {
      return { verb, rest: tokens.slice(1).join(' '), exact: false };
    }
  }
  return null;
}

/** Removes a leading article / determiner ("the", "a", "an", "my"). */
export function stripArticles(text: string): string {
  return text.replace(/^(?:the|a|an|my|our)\s+/, '').trim();
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };

export interface NumberMatch {
  value: number;
  /** Index of the first token of the number. */
  start: number;
  /** Index after the last token of the number. */
  end: number;
}

function parseDigits(token: string): number | null {
  if (!/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^-?\d+(?:\.\d+)?$|^-?\.\d+$/.test(token)) return null;
  const value = Number(token.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** Finds the first number (digits or number words) at or after token index `from`. */
export function findNumber(tokens: readonly string[], from = 0): NumberMatch | null {
  for (let start = from; start < tokens.length; start += 1) {
    const token = tokens[start] ?? '';
    const digits = parseDigits(token);
    if (digits !== null) return { value: digits, start, end: start + 1 };
    if (token === 'a' || token === 'an') {
      const next = tokens[start + 1];
      if (next !== undefined && next in SCALES) {
        return { value: SCALES[next] ?? 1, start, end: start + 2 };
      }
      continue;
    }
    if (!(token in UNITS) && !(token in TENS) && !(token in SCALES)) continue;

    let total = 0;
    let current = 0;
    let end = start;
    for (let index = start; index < tokens.length; index += 1) {
      const word = tokens[index] ?? '';
      if (word in UNITS) current += UNITS[word] ?? 0;
      else if (word in TENS) current += TENS[word] ?? 0;
      else if (word === 'hundred') current = (current === 0 ? 1 : current) * 100;
      else if (word === 'thousand') {
        total += (current === 0 ? 1 : current) * 1000;
        current = 0;
      } else if (
        word === 'and' &&
        index > start &&
        (tokens[index + 1] ?? '') in { ...UNITS, ...TENS }
      ) {
        end = index + 1;
        continue;
      } else break;
      end = index + 1;
    }
    return { value: total + current, start, end };
  }
  return null;
}

/** Formats a number without trailing zeros and with sensible precision. */
export function formatNumber(value: number, maxFractionDigits = 6): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toFixed(maxFractionDigits));
  return rounded.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });
}

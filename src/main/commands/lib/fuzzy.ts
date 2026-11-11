import { levenshtein } from '../text';

function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let index = 0;
  while (index < a.length && a[index] === b[index]) index += 1;
  return (
    index + 1 < a.length &&
    a[index] === b[index + 1] &&
    a[index + 1] === b[index] &&
    a.slice(index + 2) === b.slice(index + 2)
  );
}

/**
 * True when `token` is `word` with a small typo. Short words only tolerate a swapped or a
 * dropped letter (so "tiem" matches "time" but "tide" and "timer" do not); longer words allow
 * one wrong, missing or extra letter, and 8+ letter words allow two. The first letter must match.
 */
export function fuzzyWord(token: string, word: string): boolean {
  if (token === word) return true;
  if (word.length <= 3 || token.length < 3 || token[0] !== word[0]) return false;
  if (Math.abs(token.length - word.length) > 1) return false;
  if (word.length === 4) {
    return token.length === 3 ? levenshtein(token, word, 1) <= 1 : isTransposition(token, word);
  }
  const budget = word.length >= 8 ? 2 : 1;
  return levenshtein(token, word, budget) <= budget;
}

interface CorrectedTokens {
  tokens: string[];
  /** True when at least one token was replaced. */
  corrected: boolean;
}

/**
 * Replaces tokens that are near-misses of a `vocabulary` word. Tokens that are already
 * vocabulary words are left alone. `shouldCorrect` limits the positions that may change
 * (the word a user asks about must never be "fixed").
 */
export function correctTokens(
  tokens: readonly string[],
  vocabulary: readonly string[],
  shouldCorrect: (index: number, count: number) => boolean = () => true,
): CorrectedTokens {
  let corrected = false;
  const result = tokens.map((token, index) => {
    if (vocabulary.includes(token) || !shouldCorrect(index, tokens.length)) return token;
    const replacement = vocabulary.find((word) => fuzzyWord(token, word));
    if (replacement === undefined) return token;
    corrected = true;
    return replacement;
  });
  return { tokens: result, corrected };
}

/** "new york" -> "New York". */
export function titleCase(text: string): string {
  return text.replace(/(^|[\s-])(\p{L})/gu, (_match, separator: string, letter: string) => {
    return `${separator}${letter.toUpperCase()}`;
  });
}

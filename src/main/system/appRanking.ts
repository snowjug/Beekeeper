import { levenshtein, similarity, typoBudget } from '../commands/text';
import { matchAliases, queryVariants, type AliasHit } from './appAliases';
import type { AppMatch, InstalledApp } from './types';

/** Matches below this score are noise and never returned. */
export const MIN_APP_SCORE = 0.5;

const ALIAS_EXACT_FACTOR = 0.98;
const ALIAS_TYPO_FACTOR = 0.9;
const KIND_ORDER: Record<InstalledApp['kind'], number> = { builtin: 0, shortcut: 1, uwp: 2 };

function compact(text: string): string {
  return text.replaceAll(' ', '');
}

/** True when `needle` occurs inside `haystack` as a run of whole words. */
function containsWords(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/** True when every query word starts the next unused word of the name, in order ("vis stu" -> "visual studio"). */
function isWordPrefixMatch(queryWords: readonly string[], nameWords: readonly string[]): boolean {
  let next = 0;
  for (const word of queryWords) {
    while (next < nameWords.length && !(nameWords[next] ?? '').startsWith(word)) next += 1;
    if (next >= nameWords.length) return false;
    next += 1;
  }
  return true;
}

/**
 * Scores how well a (normalised) query names an app (normalised key). Exact 1, run-together spelling
 * 0.97, whole-word prefix 0.86-0.96, words inside the name 0.7-0.8, the app name inside a longer
 * request 0.78-0.88, prefixes and typos below that.
 */
export function scoreName(query: string, key: string): number {
  if (query.length === 0 || key.length === 0) return 0;
  if (query === key) return 1;
  const compactQuery = compact(query);
  const compactKey = compact(key);
  if (compactQuery === compactKey) return 0.97;

  const queryWords = query.split(' ');
  const nameWords = key.split(' ');
  let score = 0;

  if (key.startsWith(`${query} `)) {
    score = Math.max(score, 0.86 + 0.1 * (query.length / key.length));
  } else if (containsWords(nameWords, queryWords)) {
    score = Math.max(score, 0.7 + 0.1 * (query.length / key.length));
  }
  if (key.length >= 4 && containsWords(queryWords, nameWords)) {
    score = Math.max(score, 0.78 + 0.1 * (key.length / query.length));
  }
  if (compactQuery.length >= 3 && compactKey.startsWith(compactQuery)) {
    score = Math.max(score, 0.6 + 0.2 * (compactQuery.length / compactKey.length));
  }
  if (compactQuery.length >= 3 && isWordPrefixMatch(queryWords, nameWords)) {
    score = Math.max(score, 0.62 + 0.18 * (compactQuery.length / compactKey.length));
  }
  const budget = typoBudget(compactKey.length);
  if (budget > 0 && compactQuery.length >= 4) {
    if (levenshtein(compactQuery, compactKey, budget) <= budget) {
      score = Math.max(score, similarity(compactQuery, compactKey));
    }
  }
  return Math.min(score, 0.96);
}

function scoreApp(
  variants: readonly string[],
  hits: readonly AliasHit[],
  app: InstalledApp,
): number {
  let best = 0;
  for (const variant of variants) best = Math.max(best, scoreName(variant, app.key));
  for (const { alias, exact } of hits) {
    const factor = exact ? ALIAS_EXACT_FACTOR : ALIAS_TYPO_FACTOR;
    for (const name of alias.names) best = Math.max(best, factor * scoreName(name, app.key));
  }
  return best;
}

function compareMatches(a: AppMatch, b: AppMatch): number {
  return (
    b.score - a.score ||
    KIND_ORDER[a.app.kind] - KIND_ORDER[b.app.kind] ||
    a.app.key.length - b.app.key.length ||
    a.app.key.localeCompare(b.app.key)
  );
}

/** Ranks apps for a spoken/typed name, best first. Aliases ("vs code") and typos are understood. */
export function rankApps(query: string, apps: readonly InstalledApp[], limit = 5): AppMatch[] {
  const variants = queryVariants(query);
  if (variants.length === 0) return [];
  const hits = matchAliases(variants);
  const matches: AppMatch[] = [];
  for (const app of apps) {
    const score = scoreApp(variants, hits, app);
    if (score >= MIN_APP_SCORE) matches.push({ app, score });
  }
  matches.sort(compareMatches);
  return matches.slice(0, Math.max(1, Math.min(limit, 25)));
}

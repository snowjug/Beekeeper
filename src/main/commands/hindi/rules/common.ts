/** Shared pieces of the command rules. */
import type { Tok } from '../pipeline';
import { latinName, NOISE, type Utterance } from '../utterance';

/** A rule turns a Hindi / Hinglish utterance into the English command it means, or null. */
export type Rule = (u: Utterance) => string | null;

/** English spelling of a name token: the known city / app, a Latin word, or romanised Devanagari. */
export function nameOf(token: Tok): string {
  if (token.payload !== undefined && (token.sym === 'CITY' || token.sym === 'APP')) {
    return token.payload;
  }
  return token.kind === 'dev' ? latinName(token.text) : token.text.toLowerCase();
}

export interface PlaceSpan {
  /** English name of the place ("mumbai"). */
  name: string;
  /** Token indices that belong to the place and the word that links it ("में", "का"). */
  indices: ReadonlySet<number>;
}

const DEFAULT_PLACE_LINKS: readonly string[] = ['IN', 'KA', 'I'];
const PLACE_WORDS: ReadonlySet<string> = new Set(['CITY', 'W']);
const MAX_PLACE_WORDS = 3;
/** "in" / "इन" written before the place, as English has it. */
const LEADING_PREPOSITIONS: ReadonlySet<string> = new Set(['in', 'इन']);

/**
 * "मुंबई में", "टोक्यो का", "नई दिल्ली में": one to three city or unknown words followed by a
 * linking word (`links`), or English order ("in दिल्ली"). Unknown words are romanised
 * ("रोहतक" -> "rohtak").
 */
export function findPlace(
  u: Utterance,
  links: readonly string[] = DEFAULT_PLACE_LINKS,
): PlaceSpan | null {
  const { toks } = u;
  for (let start = 0; start < toks.length; start += 1) {
    if (!PLACE_WORDS.has(toks[start]?.sym ?? '')) continue;
    let end = start;
    while (
      end < toks.length &&
      end - start < MAX_PLACE_WORDS &&
      PLACE_WORDS.has(toks[end]?.sym ?? '')
    ) {
      end += 1;
    }
    if (!links.includes(toks[end]?.sym ?? '')) continue;
    const words = toks.slice(start, end);
    const indices = new Set<number>();
    for (let index = start; index <= end; index += 1) indices.add(index);
    return { name: words.map(nameOf).join(' '), indices };
  }
  for (let at = 0; at < toks.length; at += 1) {
    const preposition = toks[at];
    if (preposition?.sym !== 'IN' || !LEADING_PREPOSITIONS.has(preposition.text)) continue;
    let end = at + 1;
    while (
      end < toks.length &&
      end - at - 1 < MAX_PLACE_WORDS &&
      PLACE_WORDS.has(toks[end]?.sym ?? '')
    ) {
      end += 1;
    }
    if (end === at + 1) continue;
    const indices = new Set<number>();
    for (let index = at; index < end; index += 1) indices.add(index);
    return {
      name: toks
        .slice(at + 1, end)
        .map(nameOf)
        .join(' '),
      indices,
    };
  }
  return null;
}

/** True when every token is noise, one of `allowed`, or inside `used`. */
export function accounted(
  u: Utterance,
  allowed: Iterable<string>,
  used: ReadonlySet<number> = new Set(),
): boolean {
  const set = new Set(allowed);
  return u.toks.every(
    (token, index) => NOISE.has(token.sym) || set.has(token.sym) || used.has(index),
  );
}

const QUESTIONS = ['WHAT', 'HOW', 'HOWMUCH', 'WHEN', 'WHICH', 'WHO', 'WHERE'];

/**
 * "कंप्यूटर बंद है", "पीसी लॉक है": a statement about a state. A request has a "करो" / "कर दो" (or
 * no verb at all), a question has a question word.
 */
export function isStatement(u: Utterance): boolean {
  return u.has('BE', 'HOTA') && !u.has('DO', 'GIVE', ...QUESTIONS);
}

/** Free words (unknown Devanagari or Latin) outside `used`. */
export function freeWords(u: Utterance, used: ReadonlySet<number> = new Set()): Tok[] {
  return u.toks.filter((token, index) => token.sym === 'W' && !used.has(index));
}

export function percentText(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

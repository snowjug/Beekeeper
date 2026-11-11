/**
 * The compiled lexicon: maps a Hindi, Hinglish or English-in-Devanagari word (or phrase) to a
 * concept symbol with an optional payload. Words are found by exact spelling, by phonetic key
 * (so "मोसम", "मौसम" and "mausam" are one word) or, for longer words, with one or two typos.
 */
import { levenshtein } from '../text';
import { fuzzyWord } from '../lib/fuzzy';
import { APPS } from './apps';
import { PLACES } from './places';
import { romanize, romanKey, skeleton } from './romanize';
import { finalVowelVariant, hasDevanagari, lightKey } from './script';
import { VOCABULARY, type VocabularyEntry } from './vocabulary';

export interface Concept {
  sym: string;
  /** English value of the concept: unit name, city, app, weekday. */
  payload?: string;
}

interface FuzzyEntry {
  key: string;
  concept: Concept;
}

const EXACT = new Map<string, Concept>();
const KEYED = new Map<string, Concept>();
const FUZZY: FuzzyEntry[] = [];
const LOAN_SKELETONS = new Map<string, Concept>();
const LOAN_LIST: FuzzyEntry[] = [];

/** Spellings that two concepts both claim; empty in a healthy vocabulary (a test checks it). */
export const VOCABULARY_COLLISIONS: string[] = [];

function conceptOf(symbol: string): Concept {
  const at = symbol.indexOf('=');
  return at === -1 ? { sym: symbol } : { sym: symbol.slice(0, at), payload: symbol.slice(at + 1) };
}

const ROMAN_MEMO = new Map<string, string>();
const MAX_MEMO = 4096;

/** The Latin form of a word for matching ("मौसम" -> "mausam"); remembered, as every word is looked at several times. */
function latinOf(word: string): string {
  if (!hasDevanagari(word)) return word;
  let latin = ROMAN_MEMO.get(word);
  if (latin === undefined) {
    latin = romanize(word, true);
    if (ROMAN_MEMO.size >= MAX_MEMO) ROMAN_MEMO.clear();
    ROMAN_MEMO.set(word, latin);
  }
  return latin;
}

/** Phonetic key of a (possibly multi-word, possibly mixed-script) phrase, spaces ignored. */
function phraseKey(words: readonly string[]): string {
  return romanKey(words.map(latinOf).join(''));
}

function register(
  map: Map<string, Concept>,
  key: string,
  concept: Concept,
  spelling: string,
): void {
  const known = map.get(key);
  if (known !== undefined && (known.sym !== concept.sym || known.payload !== concept.payload)) {
    VOCABULARY_COLLISIONS.push(`${spelling}: ${known.sym} / ${concept.sym}`);
    return;
  }
  map.set(key, concept);
}

function addEntry([symbol, spellings]: VocabularyEntry): void {
  const concept = conceptOf(symbol);
  for (const raw of spellings.split(/\s+/)) {
    if (raw === '') continue;
    const exact = raw.startsWith('!!');
    const strict = exact || raw.startsWith('!');
    const spelling = raw.replace(/^!+/, '');
    const words = spelling.split('_');

    if (exact && words.length === 1) {
      const dev = hasDevanagari(spelling);
      register(EXACT, dev ? lightKey(spelling) : spelling.toLowerCase(), concept, spelling);
      continue;
    }
    const key = phraseKey(words);
    if (key === '') continue;
    register(KEYED, key, concept, spelling);
    if (!strict && key.length >= 5) FUZZY.push({ key, concept });
  }
}

function addLoanwords([symbol, spellings]: VocabularyEntry): void {
  const concept = conceptOf(symbol);
  const names = [concept.payload ?? '', ...spellings.split(/\s+/)];
  for (const name of names) {
    const sk = skeleton(name.replace(/^!+/, '').split(/[_ ]/).map(latinOf).join(''));
    if (sk.length < 4) continue;
    if (!LOAN_SKELETONS.has(sk)) {
      LOAN_SKELETONS.set(sk, concept);
      LOAN_LIST.push({ key: sk, concept });
    }
  }
}

for (const entry of [...VOCABULARY, ...PLACES, ...APPS]) addEntry(entry);
for (const entry of APPS) addLoanwords(entry);

function sameConcept(a: Concept, b: Concept): boolean {
  return a.sym === b.sym && a.payload === b.payload;
}

/** The concept of a word by its spelling or phonetic key. */
function findStrict(text: string, script: 'dev' | 'lat'): { concept: Concept | null; key: string } {
  const exact = EXACT.get(script === 'dev' ? lightKey(text) : text);
  const key = romanKey(latinOf(text));
  if (exact !== undefined) return { concept: exact, key };
  return { concept: key === '' ? null : (KEYED.get(key) ?? null), key };
}

/** The concept of a longer word that has one or two typos (`key` is its phonetic key). */
function findFuzzy(key: string): Concept | null {
  if (key.length < 4) return null;
  let found: Concept | null = null;
  for (const entry of FUZZY) {
    if (!fuzzyWord(key, entry.key)) continue;
    if (found !== null && !sameConcept(found, entry.concept)) return null;
    found = entry.concept;
  }
  return found;
}

/**
 * The concept of one word, found by spelling, phonetic key, then by typo tolerance. A Devanagari
 * word that is not known as written is tried with the vowel at its end read the other way ("मेरै"
 * for "मेरे", "पोन" for "पौन"), a slip speech recognisers make, before typos are allowed.
 */
export function lookupWord(text: string, script: 'dev' | 'lat'): Concept | null {
  const strict = findStrict(text, script);
  if (strict.concept !== null) return strict.concept;
  const variant = script === 'dev' ? finalVowelVariant(text) : null;
  const viaVariant = variant === null ? null : findStrict(variant, script).concept;
  return viaVariant ?? findFuzzy(strict.key);
}

/** A phrase of several words ("कौन सा", "के लिए") that the vocabulary lists as one concept. */
export function lookupPhrase(words: readonly string[]): Concept | null {
  const key = phraseKey(words);
  return key === '' ? null : (KEYED.get(key) ?? null);
}

/**
 * App, site and brand names written in Devanagari ("व्हाट्सएप" for "whatsapp"): compared by their
 * consonant skeleton, so vowel and spelling variants still land on the right name. A single word
 * may also differ by a typo; a phrase of several words must match exactly.
 */
export function lookupLoanword(words: readonly string[]): Concept | null {
  const sk = skeleton(words.map(latinOf).join(''));
  const phrase = words.length > 1;
  if (sk.length < (phrase ? 6 : 4)) return null;
  const direct = LOAN_SKELETONS.get(sk);
  if (direct !== undefined) return direct;
  if (phrase || sk.length < 5) return null;
  const budget = sk.length >= 7 ? 2 : 1;
  let best: Concept | null = null;
  for (const entry of LOAN_LIST) {
    if (entry.key[0] !== sk[0] || Math.abs(entry.key.length - sk.length) > budget) continue;
    if (levenshtein(sk, entry.key, budget) > budget) continue;
    if (best !== null && !sameConcept(best, entry.concept)) return null;
    best = entry.concept;
  }
  return best;
}

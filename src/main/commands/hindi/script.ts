/** Script helpers for Devanagari, romanised Hindi (Hinglish) and mixed text. */

const ZERO_WIDTH = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const DEVANAGARI = /[\u0900-\u0963\u0966-\u097F]/;
const DEVANAGARI_DIGITS = /[\u0966-\u096F]/g;
const DANDA = /[\u0964\u0965]/g;

export const NUKTA = '\u093C';
export const HALANT = '\u094D';
export const ANUSVARA = '\u0902';
export const CHANDRABINDU = '\u0901';
export const VISARGA = '\u0903';

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

/**
 * NFC (which also splits the precomposed nukta letters U+0958-U+095F into letter + nukta),
 * zero-width characters removed, Devanagari digits written as ASCII digits, the danda read as a
 * sentence break.
 */
export function cleanScript(text: string): string {
  return text
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(DEVANAGARI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(DANDA, ' ')
    .replace(/(?<=[\p{L}\p{M}])-(?=[\p{L}\p{M}])/gu, ' ');
}

/** Spelling slips that do not change a Devanagari word: long/short i and u, English ऑ/ॉ/ऍ/ॅ. */
const LIGHT_MAP: Readonly<Record<string, string>> = {
  '\u0901': '\u0902',
  '\u0940': '\u093F',
  '\u0942': '\u0941',
  '\u0908': '\u0907',
  '\u090A': '\u0909',
  '\u0949': '\u094B',
  '\u0945': '\u0947',
  '\u0911': '\u0913',
  '\u090D': '\u090F',
};
const LIGHT_PATTERN = new RegExp(Object.keys(LIGHT_MAP).join('|'), 'g');
const FINAL_VOWEL_SWAPS: Readonly<Record<string, string>> = {
  '\u0948': '\u0947',
  '\u0947': '\u0948',
  '\u094C': '\u094B',
  '\u094B': '\u094C',
};

/**
 * Matching form of a Devanagari word that ignores the slips speech recognisers make: nukta,
 * chandrabindu vs anusvara, short vs long i/u, the English vowels ऑ/ॉ and a final halant. It keeps
 * the letters (and so the meaning) intact, unlike the phonetic keys in romanize.ts.
 */
export function lightKey(word: string): string {
  return word
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(/\u093C/g, '')
    .replace(LIGHT_PATTERN, (mark) => LIGHT_MAP[mark] ?? mark)
    .replace(/\u094D$/, '');
}

/**
 * The word with the vowel sign at its end read the other way (ै and े, ौ and ो), or null when it
 * does not end in one: speech recognisers write "बजै" for "बजे".
 */
export function finalVowelVariant(word: string): string | null {
  const other = FINAL_VOWEL_SWAPS[word.charAt(word.length - 1)];
  return other === undefined ? null : `${word.slice(0, -1)}${other}`;
}

export type RawKind = 'dev' | 'lat' | 'num' | 'sym' | 'url';

export interface RawToken {
  /** Matching form: Latin words are lower-cased, numbers have their thousands commas removed. */
  text: string;
  /** The word as it was spoken or typed. */
  orig: string;
  kind: RawKind;
}

const TOKEN =
  /(https?:\/\/[^\s]+|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[^\s]*)?)|([\u0900-\u0963\u0966-\u097F]+)|([A-Za-z]+(?:['\u2019-][A-Za-z]+)*)|(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.:]\d+)*)|([%+\-*/^\u00D7\u00F7=])/g;

/**
 * Splits cleaned text into web addresses, Devanagari words, Latin words, numbers ("7:30", "2.5",
 * "1,000") and operator symbols. Everything else is a separator. Digits glued to letters ("5min")
 * are split.
 */
export function tokenize(text: string): RawToken[] {
  const tokens: RawToken[] = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match !== null; match = TOKEN.exec(text)) {
    const [, url, dev, lat, num, sym] = match;
    if (url !== undefined) tokens.push({ text: url.toLowerCase(), orig: url, kind: 'url' });
    else if (dev !== undefined) tokens.push({ text: dev, orig: dev, kind: 'dev' });
    else if (lat !== undefined) tokens.push({ text: lat.toLowerCase(), orig: lat, kind: 'lat' });
    else if (num !== undefined)
      tokens.push({ text: num.replace(/,/g, ''), orig: num, kind: 'num' });
    else if (sym !== undefined) tokens.push({ text: sym, orig: sym, kind: 'sym' });
  }
  return tokens;
}

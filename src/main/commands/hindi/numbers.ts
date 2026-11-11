/**
 * Hindi, Hinglish and English-in-Devanagari number words: lookup tables and the compound reader
 * ("एक सौ बीस" = 120, "साढ़े तीन सौ" = 350, "डेढ़" = 1.5, "पौने आठ" = 7.75).
 */
import { finalVowelVariant, lightKey } from './script';

export type FracKind = 'half' | 'dedh' | 'dhai' | 'sava' | 'paun' | 'paune' | 'sadhe';

export interface NumberInfo {
  /** digits: "7", "2.5"; word: 0-99 words; scale: सौ/हज़ार/लाख/करोड़; frac: डेढ़, ढाई, आधा, सवा ... */
  kind: 'digits' | 'word' | 'scale' | 'frac';
  value: number;
  /** "एक" and "दो" are also an article and a verb: they only count as numbers in number context. */
  ambiguous?: boolean;
  /** Spoken in English ("ट्वेंटी फाइव"): tens and units combine without a scale word. */
  english?: boolean;
  frac?: FracKind;
}

/** Anything that may carry a number (the lexer's token type extends this). */
export interface NumberToken {
  num?: NumberInfo;
}

const HINDI_WORDS: ReadonlyArray<readonly [number, string]> = [
  [0, 'शून्य सुन्न'],
  [1, 'एक*'],
  [2, 'दो*'],
  [3, 'तीन'],
  [4, 'चार'],
  [5, 'पाँच पांच पाच'],
  [6, 'छह छः छे छै छ'],
  [7, 'सात'],
  [8, 'आठ'],
  [9, 'नौ'],
  [10, 'दस'],
  [11, 'ग्यारह ग्यारा'],
  [12, 'बारह बारा'],
  [13, 'तेरह तेरा'],
  [14, 'चौदह चौदा'],
  [15, 'पंद्रह पन्द्रह पंद्रा पन्द्रा'],
  [16, 'सोलह सोला'],
  [17, 'सत्रह सतरह सत्रा'],
  [18, 'अठारह अट्ठारह अठारा'],
  [19, 'उन्नीस उन्निस उनीस'],
  [20, 'बीस'],
  [21, 'इक्कीस इकीस'],
  [22, 'बाईस बाइस'],
  [23, 'तेईस तेइस'],
  [24, 'चौबीस'],
  [25, 'पच्चीस पचीस'],
  [26, 'छब्बीस छबीस'],
  [27, 'सत्ताईस सताईस सत्ताइस'],
  [28, 'अट्ठाईस अठाईस अठ्ठाईस'],
  [29, 'उनतीस उन्तीस उनत्तीस'],
  [30, 'तीस'],
  [31, 'इकतीस इकत्तीस'],
  [32, 'बत्तीस बतीस'],
  [33, 'तैंतीस तेंतीस तैतीस'],
  [34, 'चौंतीस चौतीस'],
  [35, 'पैंतीस पैतीस'],
  [36, 'छत्तीस छतीस'],
  [37, 'सैंतीस सैतीस'],
  [38, 'अड़तीस अठतीस'],
  [39, 'उनतालीस उन्तालीस उनचालीस'],
  [40, 'चालीस'],
  [41, 'इकतालीस इकतालिस'],
  [42, 'बयालीस बयालिस'],
  [43, 'तैंतालीस तेतालीस तिरतालीस'],
  [44, 'चौवालीस चवालीस चौआलीस'],
  [45, 'पैंतालीस पैतालीस'],
  [46, 'छियालीस छयालीस'],
  [47, 'सैंतालीस सैतालीस'],
  [48, 'अड़तालीस अठतालीस'],
  [49, 'उनचास उन्चास'],
  [50, 'पचास'],
  [51, 'इक्यावन'],
  [52, 'बावन'],
  [53, 'तिरपन तिरेपन'],
  [54, 'चौवन चौअन'],
  [55, 'पचपन'],
  [56, 'छप्पन छपन'],
  [57, 'सत्तावन सतावन'],
  [58, 'अट्ठावन अठावन'],
  [59, 'उनसठ उन्सठ'],
  [60, 'साठ'],
  [61, 'इकसठ'],
  [62, 'बासठ'],
  [63, 'तिरसठ तिरेसठ'],
  [64, 'चौंसठ चौसठ'],
  [65, 'पैंसठ पैसठ'],
  [66, 'छियासठ छयासठ'],
  [67, 'सड़सठ सरसठ'],
  [68, 'अड़सठ अरसठ'],
  [69, 'उनहत्तर उनहतर उन्हत्तर'],
  [70, 'सत्तर'],
  [71, 'इकहत्तर'],
  [72, 'बहत्तर बहतर'],
  [73, 'तिहत्तर'],
  [74, 'चौहत्तर'],
  [75, 'पचहत्तर पचहतर'],
  [76, 'छिहत्तर'],
  [77, 'सतहत्तर'],
  [78, 'अठहत्तर'],
  [79, 'उन्यासी उनासी'],
  [80, 'अस्सी असी'],
  [81, 'इक्यासी'],
  [82, 'बयासी'],
  [83, 'तिरासी'],
  [84, 'चौरासी'],
  [85, 'पचासी'],
  [86, 'छियासी'],
  [87, 'सतासी'],
  [88, 'अट्ठासी अठासी'],
  [89, 'नवासी'],
  [90, 'नब्बे नब्बै'],
  [91, 'इक्यानवे इक्यानबे'],
  [92, 'बानवे बानबे'],
  [93, 'तिरानवे तिरानबे'],
  [94, 'चौरानवे चौरानबे'],
  [95, 'पचानवे पचानबे'],
  [96, 'छियानवे छियानबे'],
  [97, 'सत्तानवे सत्तानबे'],
  [98, 'अट्ठानवे अठानवे'],
  [99, 'निन्यानवे निन्यानबे'],
];

const SCALES: ReadonlyArray<readonly [number, string]> = [
  [100, 'सौ'],
  [1000, 'हज़ार हजार'],
  [100_000, 'लाख'],
  [10_000_000, 'करोड़ करोड'],
];

/** English number words as Whisper writes them in Devanagari. `*` marks words that are also something else. */
const ENGLISH_WORDS: ReadonlyArray<readonly [number, string]> = [
  [0, 'ज़ीरो जीरो'],
  [1, 'वन*'],
  [2, 'टू*'],
  [3, 'थ्री'],
  [4, 'फोर*'],
  [5, 'फाइव'],
  [6, 'सिक्स'],
  [7, 'सेवन'],
  [8, 'एट* एइट'],
  [9, 'नाइन'],
  [10, 'टेन'],
  [11, 'इलेवन'],
  [12, 'ट्वेल्व ट्वेल्भ'],
  [13, 'थर्टीन'],
  [14, 'फोर्टीन'],
  [15, 'फिफ्टीन'],
  [16, 'सिक्सटीन'],
  [17, 'सेवनटीन'],
  [18, 'एटीन'],
  [19, 'नाइनटीन'],
  [20, 'ट्वेंटी'],
  [30, 'थर्टी'],
  [40, 'फोर्टी'],
  [50, 'फिफ्टी'],
  [60, 'सिक्सटी'],
  [70, 'सेवेंटी'],
  [80, 'एटी'],
  [90, 'नाइंटी'],
];
const ENGLISH_SCALES: ReadonlyArray<readonly [number, string]> = [
  [100, 'हंड्रेड हन्ड्रेड'],
  [1000, 'थाउजेंड थाउज़ेंड'],
];

/** Romanised Hindi number words, exact lower-case spellings. `*` marks ambiguous words. */
const ROMAN_WORDS: ReadonlyArray<readonly [number, string]> = [
  [0, 'shunya'],
  [1, 'ek*'],
  [2, 'do*'],
  [3, 'teen tin'],
  [4, 'char chaar'],
  [5, 'paanch panch pach paach'],
  [6, 'chhe chhah chheh che chah chhey chhai'],
  [7, 'saat'],
  [8, 'aath ath aat'],
  [9, 'nau nao'],
  [10, 'das dus'],
  [11, 'gyarah gyaarah'],
  [12, 'barah baarah'],
  [13, 'terah'],
  [14, 'chaudah chaudha'],
  [15, 'pandrah pandra'],
  [16, 'solah sola'],
  [17, 'satrah satra'],
  [18, 'atharah athara'],
  [19, 'unnis unnees'],
  [20, 'bees bis'],
  [25, 'pachchis pachees pachis'],
  [30, 'tees'],
  [40, 'chalis chaalis'],
  [50, 'pachas pachaas'],
];
const ROMAN_SCALES: ReadonlyArray<readonly [number, string]> = [
  [100, 'sau'],
  [1000, 'hazaar hazar'],
  [100_000, 'lakh'],
  [10_000_000, 'crore karod'],
];

/** English number words typed in Latin script inside a Hinglish sentence. */
const LATIN_ENGLISH: ReadonlyArray<readonly [number, string]> = [
  [0, 'zero'],
  [1, 'one*'],
  [2, 'two*'],
  [3, 'three'],
  [4, 'four*'],
  [5, 'five'],
  [6, 'six'],
  [7, 'seven'],
  [8, 'eight'],
  [9, 'nine'],
  [10, 'ten'],
  [11, 'eleven'],
  [12, 'twelve'],
  [13, 'thirteen'],
  [14, 'fourteen'],
  [15, 'fifteen'],
  [16, 'sixteen'],
  [17, 'seventeen'],
  [18, 'eighteen'],
  [19, 'nineteen'],
  [20, 'twenty'],
  [30, 'thirty'],
  [40, 'forty'],
  [50, 'fifty'],
  [60, 'sixty'],
  [70, 'seventy'],
  [80, 'eighty'],
  [90, 'ninety'],
];
const LATIN_SCALES: ReadonlyArray<readonly [number, string]> = [
  [100, 'hundred'],
  [1000, 'thousand'],
];

const FRACTIONS: ReadonlyArray<readonly [FracKind, number, string]> = [
  ['dedh', 1.5, 'डेढ़ डेढ'],
  ['dhai', 2.5, 'ढाई ढाइ'],
  ['half', 0.5, 'आधा आधी आधे'],
  ['sava', 1.25, 'सवा'],
  ['paun', 0.75, 'पौन पोन'],
  ['paune', -0.25, 'पौने पोने'],
  ['sadhe', 0.5, 'साढ़े साड़े साढे'],
];
const ROMAN_FRACTIONS: ReadonlyArray<readonly [FracKind, number, string]> = [
  ['dedh', 1.5, 'dedh derh'],
  ['dhai', 2.5, 'dhai dhaai'],
  ['half', 0.5, 'aadha adha aadhe adhe aadhi adhi'],
  ['sava', 1.25, 'sawa sava'],
  ['paun', 0.75, 'paun poun'],
  ['paune', -0.25, 'paune poune'],
  ['sadhe', 0.5, 'saadhe sadhe'],
];

const DEVANAGARI_TABLE = new Map<string, NumberInfo>();
const ROMAN_TABLE = new Map<string, NumberInfo>();

function addWords(
  table: Map<string, NumberInfo>,
  entries: ReadonlyArray<readonly [number, string]>,
  kind: NumberInfo['kind'],
  options: { english?: boolean; normalize: (word: string) => string },
): void {
  for (const [value, spellings] of entries) {
    for (const spelling of spellings.split(' ')) {
      const ambiguous = spelling.endsWith('*');
      const word = options.normalize(ambiguous ? spelling.slice(0, -1) : spelling);
      const info: NumberInfo = { kind, value };
      if (ambiguous) info.ambiguous = true;
      if (options.english === true) info.english = true;
      table.set(word, info);
    }
  }
}

function addFractions(
  table: Map<string, NumberInfo>,
  entries: ReadonlyArray<readonly [FracKind, number, string]>,
  normalize: (word: string) => string,
): void {
  for (const [frac, value, spellings] of entries) {
    for (const spelling of spellings.split(' ')) {
      table.set(normalize(spelling), { kind: 'frac', value, frac });
    }
  }
}

const keepAsIs = (word: string): string => word;
addWords(DEVANAGARI_TABLE, HINDI_WORDS, 'word', { normalize: lightKey });
addWords(DEVANAGARI_TABLE, SCALES, 'scale', { normalize: lightKey });
addWords(DEVANAGARI_TABLE, ENGLISH_WORDS, 'word', { english: true, normalize: lightKey });
addWords(DEVANAGARI_TABLE, ENGLISH_SCALES, 'scale', { english: true, normalize: lightKey });
addFractions(DEVANAGARI_TABLE, FRACTIONS, lightKey);
addWords(ROMAN_TABLE, ROMAN_WORDS, 'word', { normalize: keepAsIs });
addWords(ROMAN_TABLE, ROMAN_SCALES, 'scale', { normalize: keepAsIs });
addWords(ROMAN_TABLE, LATIN_ENGLISH, 'word', { english: true, normalize: keepAsIs });
addWords(ROMAN_TABLE, LATIN_SCALES, 'scale', { english: true, normalize: keepAsIs });
addFractions(ROMAN_TABLE, ROMAN_FRACTIONS, keepAsIs);

/** The number a Devanagari or Latin word stands for ("पाँच", "paanch", "टेन"), or null. */
export function lookupNumberWord(word: string, script: 'dev' | 'lat'): NumberInfo | null {
  if (script === 'lat') return ROMAN_TABLE.get(word) ?? null;
  const known = DEVANAGARI_TABLE.get(lightKey(word));
  if (known !== undefined) return known;
  const variant = finalVowelVariant(word);
  return variant === null ? null : (DEVANAGARI_TABLE.get(lightKey(variant)) ?? null);
}

/** A plain number token ("7", "2.5"); clock times such as "7:30" are not numbers. */
export function digitsInfo(text: string): NumberInfo | null {
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? { kind: 'digits', value } : null;
}

export interface NumberRead {
  value: number;
  /** Index of the token after the number. */
  end: number;
}

function numAt(tokens: readonly NumberToken[], index: number): NumberInfo | undefined {
  return tokens[index]?.num;
}

function isPlain(info: NumberInfo | undefined): info is NumberInfo {
  return info !== undefined && (info.kind === 'word' || info.kind === 'digits');
}

function applyScale(tokens: readonly NumberToken[], index: number, value: number): NumberRead {
  const next = numAt(tokens, index);
  if (next?.kind === 'scale') return { value: value * next.value, end: index + 1 };
  return { value, end: index };
}

/** "साढ़े तीन", "सवा सात", "पौने आठ", "डेढ़", "ढाई", "आधा", optionally times a scale ("डेढ़ सौ"). */
function readFraction(
  tokens: readonly NumberToken[],
  start: number,
  info: NumberInfo,
): NumberRead | null {
  const afterPrefix = start + 1;
  const operand = numAt(tokens, afterPrefix);
  switch (info.frac) {
    case 'dedh':
    case 'dhai':
    case 'half':
    case 'paun':
      return applyScale(tokens, afterPrefix, info.value);
    case 'sava':
      return isPlain(operand)
        ? applyScale(tokens, afterPrefix + 1, operand.value + 0.25)
        : applyScale(tokens, afterPrefix, info.value);
    case 'sadhe':
    case 'paune':
      return isPlain(operand)
        ? applyScale(tokens, afterPrefix + 1, operand.value + info.value)
        : null;
    default:
      return null;
  }
}

function joinsEnglishTens(previous: NumberInfo | undefined, info: NumberInfo): boolean {
  return (
    previous?.english === true &&
    previous.kind === 'word' &&
    previous.value >= 20 &&
    previous.value % 10 === 0 &&
    info.english === true &&
    info.kind === 'word' &&
    info.value >= 1 &&
    info.value <= 9
  );
}

/**
 * Reads the number that starts at `start`: digits, a number word, a compound with scale words, or a
 * fraction word. Returns null when the token is not a number. "एक"/"दो" are accepted here; the
 * caller decides whether they are numbers in their context.
 */
export function readNumber(tokens: readonly NumberToken[], start: number): NumberRead | null {
  const first = numAt(tokens, start);
  if (first === undefined) return null;
  if (first.kind === 'frac') return readFraction(tokens, start, first);

  let total = 0;
  let current = 0;
  let index = start;
  let previous: NumberInfo | undefined;
  for (; index < tokens.length; index += 1) {
    const info = numAt(tokens, index);
    if (info === undefined || info.kind === 'frac') break;
    if (info.kind === 'scale') {
      // Scales descend: "दो हज़ार पाँच सौ", never "सौ हज़ार".
      if (previous?.kind === 'scale' && previous.value <= info.value) break;
      if (info.value === 100) current = (current === 0 ? 1 : current) * 100;
      else {
        total += (current === 0 ? 1 : current) * info.value;
        current = 0;
      }
    } else if (index === start) {
      current = info.value;
    } else if (previous?.kind === 'scale' || joinsEnglishTens(previous, info)) {
      current += info.value;
    } else {
      break;
    }
    previous = info;
  }
  return index === start ? null : { value: total + current, end: index };
}

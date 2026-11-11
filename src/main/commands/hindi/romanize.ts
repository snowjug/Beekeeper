/**
 * Devanagari -> Latin romaniser (ITRANS-like, with Hindi schwa deletion) and the phonetic keys the
 * rest of the Hindi support matches with. Pure string functions, no state.
 */
import { ANUSVARA, CHANDRABINDU, HALANT, NUKTA, VISARGA } from './script';

function table(spec: string): ReadonlyMap<string, string> {
  const parts = spec.trim().split(/\s+/);
  const map = new Map<string, string>();
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const key = parts[index];
    const value = parts[index + 1];
    if (key !== undefined && value !== undefined) map.set(key, value);
  }
  return map;
}

const CONSONANTS = table(
  'क k ख kh ग g घ gh ङ n च ch छ chh ज j झ jh ञ n ट t ठ th ड d ढ dh ण n त t थ th द d ध dh न n ' +
    'प p फ ph ब b भ bh म m य y र r ल l ळ l व v श sh ष sh स s ह h',
);
const NUKTA_CONSONANTS = table('क q ख kh ग g ज z ड r ढ rh फ f य y');
/** In keys the flaps ड़/ढ़ are written the way Hinglish typists do ("badhao", "jodo"). */
const NUKTA_CONSONANTS_KEY = table('क q ख kh ग g ज z ड d ढ dh फ f य y');
const MATRAS = table('ा a ि i ी i ु u ू u ृ ri े e ै ai ो o ौ au ॉ o ॅ e ॆ e ॊ o');
const INDEPENDENT_VOWELS = table(
  'अ a आ a इ i ई i उ u ऊ u ऋ ri ए e ऐ ai ओ o औ au ऑ o ऍ e ऎ e ऒ o ॲ a',
);
const LABIALS: ReadonlySet<string> = new Set(['p', 'b', 'm']);

interface Unit {
  consonant: string;
  /** Romanised explicit vowel (a matra or an independent vowel); empty when there is none. */
  vowel: string;
  /** The consonant carries the inherent "a" (no matra, no halant). */
  inherent: boolean;
  halant: boolean;
  independent: boolean;
  nasal: boolean;
  visarga: boolean;
}

function newUnit(consonant: string): Unit {
  return {
    consonant,
    vowel: '',
    inherent: false,
    halant: false,
    independent: false,
    nasal: false,
    visarga: false,
  };
}

function parseUnits(word: string, forKey: boolean): Unit[] {
  const nuktaTable = forKey ? NUKTA_CONSONANTS_KEY : NUKTA_CONSONANTS;
  const chars = Array.from(word);
  const units: Unit[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index] ?? '';
    const consonant = CONSONANTS.get(char);
    if (consonant !== undefined) {
      let roman = consonant;
      index += 1;
      if (chars[index] === NUKTA) {
        roman = nuktaTable.get(char) ?? roman;
        index += 1;
      }
      const unit = newUnit(roman);
      const next = chars[index] ?? '';
      const matra = MATRAS.get(next);
      if (matra !== undefined) {
        unit.vowel = matra;
        index += 1;
      } else if (next === HALANT) {
        unit.halant = true;
        index += 1;
        // ज्ञ is pronounced "gya", not "jna".
        if (char === 'ज' && chars[index] === 'ञ') {
          unit.consonant = 'g';
          unit.halant = false;
          unit.vowel = '';
          unit.inherent = false;
          units.push(unit);
          const pronounced = newUnit('y');
          index += 1;
          const afterMatra = MATRAS.get(chars[index] ?? '');
          if (afterMatra !== undefined) {
            pronounced.vowel = afterMatra;
            index += 1;
          } else {
            pronounced.inherent = true;
          }
          units.push(pronounced);
          continue;
        }
      } else {
        unit.inherent = true;
      }
      units.push(unit);
      continue;
    }

    const vowel = INDEPENDENT_VOWELS.get(char);
    if (vowel !== undefined) {
      const unit = newUnit('');
      unit.vowel = vowel;
      unit.independent = true;
      units.push(unit);
    } else if (char === ANUSVARA || char === CHANDRABINDU) {
      const previous = units[units.length - 1];
      if (previous !== undefined) previous.nasal = true;
    } else if (char === VISARGA) {
      const previous = units[units.length - 1];
      if (previous !== undefined) previous.visarga = true;
    }
    index += 1;
  }
  return units;
}

/**
 * Hindi drops the inherent "a" at the end of a word and in a VC_CV context ("kamal", "rohtak",
 * "samajhna"). Applied right to left; a syllable closed by a nasal is heavy and keeps its vowel.
 */
function keptSchwas(units: readonly Unit[]): boolean[] {
  const keep = units.map((unit) => unit.inherent);
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (unit === undefined || !unit.inherent) continue;
    if (index === units.length - 1) {
      if (index > 0) keep[index] = false;
      continue;
    }
    if (index === 0) continue;
    const previous = units[index - 1];
    const next = units[index + 1];
    if (previous === undefined || next === undefined) continue;
    const previousVowel = !previous.halant;
    const nextVowel = next.independent
      ? false
      : next.vowel !== '' || (next.inherent && keep[index + 1] === true);
    if (previousVowel && !previous.nasal && nextVowel) keep[index] = false;
  }
  return keep;
}

function romanizeWord(word: string, forKey: boolean): string {
  const units = parseUnits(word, forKey);
  const keep = keptSchwas(units);
  let out = '';
  units.forEach((unit, index) => {
    const next = units[index + 1];
    out += unit.consonant;
    if (unit.vowel !== '') out += unit.vowel;
    else if (keep[index] === true) out += 'a';
    if (unit.nasal) out += next !== undefined && LABIALS.has(next.consonant.charAt(0)) ? 'm' : 'n';
    if (unit.visarga) out += 'h';
    // "लिए" is pronounced "liye": a glide joins i to the vowel that follows.
    if (unit.vowel === 'i' && next?.independent === true) out += 'y';
  });
  return out;
}

/**
 * Romanises every Devanagari run of `text`; Latin text, digits and punctuation stay as they are.
 * `forKey` writes ड़ and ढ़ as "d" and "dh" (how Hinglish is typed) for the phonetic keys.
 */
export function romanize(text: string, forKey = false): string {
  return text.replace(/[\u0900-\u0963\u0966-\u097F]+/g, (word) => romanizeWord(word, forKey));
}

/**
 * Phonetic key for Hindi words in either script ("kholo", "खोलो", "kholiye", "खोलिए"):
 * aspirates, v/w, z/j, f/ph, the long vowels and the diphthongs all collapse, so the usual
 * romanisation and recognition variants of one word share a key.
 */
export function romanKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/chh?/g, 'C')
    .replace(/sh/g, 's')
    .replace(/c/g, 'k')
    .replace(/C/g, 'c')
    .replace(/([kgjtdpbc])h/g, '$1')
    .replace(/rh/g, 'd')
    .replace(/f/g, 'p')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/aa/g, 'a')
    .replace(/ee|ii/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/ai|ay|ei|ey|ae/g, 'e')
    .replace(/au|ou|aw|ow/g, 'o')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/([aeiou])h$/, '$1')
    .replace(/([aeiou])h(?=[aeiou])/g, '$1');
}

/**
 * Consonant skeleton of a word as spoken, for English words written in Devanagari ("क्रोम" and
 * "chrome" are both "krm"): vowels, y and h drop out, voiced and unvoiced dentals merge, English
 * spelling quirks (ph, ck, igh, kn-, chr) are folded in. A leading vowel is kept as "a".
 */
export function skeleton(text: string): string {
  const letters = text.toLowerCase().replace(/[^a-z]/g, '');
  if (letters === '') return '';
  const body = letters
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/sch/g, 'sk')
    .replace(/tch/g, 'C')
    .replace(/dge/g, 'j')
    .replace(/chr/g, 'kr')
    .replace(/chh?/g, 'C')
    .replace(/sh/g, 's')
    .replace(/igh/g, 'i')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/([kgjtdpbC])h/g, '$1')
    .replace(/qu?/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/C/g, 'c')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/d/g, 't')
    .replace(/[aeiouyh]/g, '')
    .replace(/([a-z])\1+/g, '$1');
  return /^[aeiou]/.test(letters) ? `a${body}` : body;
}

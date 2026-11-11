import { describe, expect, it } from 'vitest';
import {
  digitsInfo,
  lookupNumberWord,
  readNumber,
  type NumberToken,
} from '@main/commands/hindi/numbers';

/** Reads a spoken number the way the lexer does: every word is looked up, then the run is read. */
function read(words: string, script: 'dev' | 'lat' = 'dev'): number | null {
  const tokens: NumberToken[] = words.split(' ').map((word) => {
    const num = lookupNumberWord(word, script) ?? digitsInfo(word);
    return num === null ? {} : { num };
  });
  const result = readNumber(tokens, 0);
  return result === null || result.end !== tokens.length ? null : result.value;
}

describe('Hindi number words', () => {
  it.each([
    ['शून्य', 0],
    ['तीन', 3],
    ['पाँच', 5],
    ['पांच', 5],
    ['पाच', 5],
    ['छह', 6],
    ['छः', 6],
    ['दस', 10],
    ['ग्यारह', 11],
    ['बारह', 12],
    ['पंद्रह', 15],
    ['सोलह', 16],
    ['बीस', 20],
    ['पच्चीस', 25],
    ['पचीस', 25],
    ['तीस', 30],
    ['पैंतालीस', 45],
    ['पचास', 50],
    ['साठ', 60],
    ['पचहत्तर', 75],
    ['निन्यानवे', 99],
    ['सौ', 100],
  ])('%s = %d', (word, value) => {
    expect(read(word)).toBe(value);
  });

  it.each([
    ['एक सौ बीस', 120],
    ['दो सौ पचास', 250],
    ['पाँच सौ', 500],
    ['एक हज़ार', 1000],
    ['दो हज़ार पाँच सौ', 2500],
    ['दो हज़ार पाँच सौ पच्चीस', 2525],
    ['एक लाख', 100_000],
    ['दस लाख', 1_000_000],
    ['एक करोड़', 10_000_000],
  ])('compound %s = %d', (words, value) => {
    expect(read(words)).toBe(value);
  });

  it.each([
    ['डेढ़', 1.5],
    ['ढाई', 2.5],
    ['आधा', 0.5],
    ['सवा सात', 7.25],
    ['सवा', 1.25],
    ['पौन', 0.75],
    ['पौने आठ', 7.75],
    ['पोने आठ', 7.75],
    ['साढै तीन', 3.5],
    ['साढ़े तीन', 3.5],
    ['साढ़े सात', 7.5],
    ['साढ़े तीन सौ', 350],
    ['डेढ़ सौ', 150],
    ['ढाई हज़ार', 2500],
  ])('fraction %s = %d', (words, value) => {
    expect(read(words)).toBe(value);
  });

  it('does not let a larger scale follow a smaller one', () => {
    const tokens: NumberToken[] = ['सौ', 'हज़ार'].map((word) => {
      const num = lookupNumberWord(word, 'dev');
      return num === null ? {} : { num };
    });
    expect(readNumber(tokens, 0)).toMatchObject({ value: 100, end: 1 });
  });

  it('knows that "एक" and "दो" are also other words', () => {
    expect(lookupNumberWord('एक', 'dev')).toMatchObject({ value: 1, ambiguous: true });
    expect(lookupNumberWord('दो', 'dev')).toMatchObject({ value: 2, ambiguous: true });
    expect(lookupNumberWord('तीन', 'dev')?.ambiguous).toBeUndefined();
  });

  it('is not fooled by words that are not numbers', () => {
    expect(lookupNumberWord('मौसम', 'dev')).toBeNull();
    expect(lookupNumberWord('weather', 'lat')).toBeNull();
    expect(read('मौसम')).toBeNull();
  });
});

describe('English number words in Devanagari and romanised Hindi', () => {
  it.each([
    ['टेन', 10],
    ['फाइव', 5],
    ['सेवन', 7],
    ['ट्वेंटी फाइव', 25],
    ['थर्टी', 30],
    ['फिफ्टी', 50],
    ['हंड्रेड', 100],
  ])('%s = %d', (words, value) => {
    expect(read(words)).toBe(value);
  });

  it.each([
    ['paanch', 5],
    ['das', 10],
    ['bees', 20],
    ['pachaas', 50],
    ['sau', 100],
    ['dedh', 1.5],
    ['dhai', 2.5],
    ['twenty five', 25],
    ['ek sau bees', 120],
  ])('%s = %d', (words, value) => {
    expect(read(words, 'lat')).toBe(value);
  });
});

describe('digits', () => {
  it('reads plain numbers', () => {
    expect(digitsInfo('7')).toMatchObject({ kind: 'digits', value: 7 });
    expect(digitsInfo('2.5')).toMatchObject({ value: 2.5 });
    expect(digitsInfo('120')).toMatchObject({ value: 120 });
  });

  it('leaves clock times and words alone', () => {
    expect(digitsInfo('7:30')).toBeNull();
    expect(digitsInfo('abc')).toBeNull();
    expect(digitsInfo('')).toBeNull();
  });

  it('multiplies a digit by a scale word', () => {
    expect(read('5 सौ')).toBe(500);
    expect(read('2 हज़ार')).toBe(2000);
  });
});

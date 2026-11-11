import { describe, expect, it } from 'vitest';
import { correctTokens, fuzzyWord, titleCase } from '@main/commands/lib/fuzzy';

describe('fuzzyWord', () => {
  it.each([
    ['time', 'time'],
    ['tiem', 'time'],
    ['tim', 'time'],
    ['wat', 'what'],
    ['weahter', 'weather'],
    ['wether', 'weather'],
    ['wheather', 'weather'],
    ['calcualte', 'calculate'],
    ['tommorow', 'tomorrow'],
    ['tomorow', 'tomorrow'],
    ['temprature', 'temperature'],
    ['saterday', 'saturday'],
    ['wendsday', 'wednesday'],
  ])('%s is a typo of %s', (token, word) => {
    expect(fuzzyWord(token, word)).toBe(true);
  });

  it.each([
    ['tide', 'time'],
    ['timer', 'time'],
    ['times', 'time'],
    ['rate', 'date'],
    ['data', 'date'],
    ['whether', 'weather'],
    ['forest', 'forecast'],
    ['sunder', 'sunday'],
    ['go', 'goal'],
    ['xtime', 'time'],
    ['dat', 'day'],
    ['an', 'and'],
  ])('%s is not a typo of %s', (token, word) => {
    expect(fuzzyWord(token, word)).toBe(false);
  });
});

describe('correctTokens', () => {
  const vocabulary = ['time', 'weather', 'tomorrow'];

  it('repairs near-misses and reports it', () => {
    expect(correctTokens(['whats', 'the', 'tiem'], vocabulary)).toEqual({
      tokens: ['whats', 'the', 'time'],
      corrected: true,
    });
  });

  it('leaves vocabulary words and unrelated words alone', () => {
    expect(correctTokens(['weather', 'in', 'paris'], vocabulary)).toEqual({
      tokens: ['weather', 'in', 'paris'],
      corrected: false,
    });
  });

  it('only touches the positions it is allowed to', () => {
    const result = correctTokens(['wether', 'in', 'wether'], vocabulary, (index) => index === 0);
    expect(result.tokens).toEqual(['weather', 'in', 'wether']);
  });
});

describe('titleCase', () => {
  it.each([
    ['new york', 'New York'],
    ['paris', 'Paris'],
    ['winston-salem', 'Winston-Salem'],
    ['são paulo', 'São Paulo'],
    ['st. louis', 'St. Louis'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });
});

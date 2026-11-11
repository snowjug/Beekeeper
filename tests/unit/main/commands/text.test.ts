import { describe, expect, it } from 'vitest';
import {
  findNumber,
  formatNumber,
  fuzzyEquals,
  levenshtein,
  matchLeadingVerb,
  matchPhrase,
  normalizeInput,
  similarity,
  stripArticles,
  typoBudget,
} from '@main/commands/text';

describe('normalizeInput', () => {
  it.each([
    ['What time is it?', 'what time is it'],
    ['  Hey Beekeeper, open Notepad please  ', 'open notepad'],
    ['OK bee keeper: what is the weather', 'what is the weather'],
    ['Could you please set a timer for 5 minutes?', 'set a timer for 5 minutes'],
    ["I'd like you to take a note buy milk", 'take a note buy milk'],
    ['Um, so, volume up!', 'volume up'],
    ['calculate 15% of 2400.', 'calculate 15% of 2400'],
    ['what’s the date', "what's the date"],
    ['open spotify for me', 'open spotify'],
    ['', ''],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeInput(raw).text).toBe(expected);
  });

  it('keeps the raw input and tokenises', () => {
    const input = normalizeInput('Open   Notepad');
    expect(input.raw).toBe('Open   Notepad');
    expect(input.tokens).toEqual(['open', 'notepad']);
    expect(normalizeInput('   ').tokens).toEqual([]);
  });
});

describe('edit distance helpers', () => {
  it('computes levenshtein distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('opne', 'open')).toBe(1);
  });

  it('bails out early beyond the max distance', () => {
    expect(levenshtein('abcdefgh', 'zzzzzzzz', 2)).toBeGreaterThan(2);
    expect(levenshtein('a', 'abcdef', 2)).toBeGreaterThan(2);
  });

  it('scores similarity between 0 and 1', () => {
    expect(similarity('open', 'open')).toBe(1);
    expect(similarity('', '')).toBe(1);
    expect(similarity('open', 'opne')).toBeCloseTo(0.75);
    expect(similarity('abc', 'xyz')).toBe(0);
  });

  it('scales the typo budget with phrase length', () => {
    expect(typoBudget(4)).toBe(0);
    expect(typoBudget(5)).toBe(1);
    expect(typoBudget(15)).toBe(3);
    expect(typoBudget(60)).toBe(3);
  });

  it('matches phrases with typos but not short look-alikes', () => {
    expect(fuzzyEquals('wat time is it', 'what time is it')).toBe(true);
    expect(fuzzyEquals('step', 'stop')).toBe(false);
    expect(matchPhrase('what time is it', ['what time is it'])).toBe('what time is it');
    expect(matchPhrase('whats the datee', ['whats the date', 'what time is it'])).toBe(
      'whats the date',
    );
    expect(matchPhrase('banana', ['what time is it'])).toBeNull();
  });
});

describe('matchLeadingVerb', () => {
  const verbs = ['open', 'launch', 'fire up', 'start'];

  it('matches exact and multi-word verbs', () => {
    expect(matchLeadingVerb('open notepad', verbs)).toEqual({
      verb: 'open',
      rest: 'notepad',
      exact: true,
    });
    expect(matchLeadingVerb('fire up spotify', verbs)).toEqual({
      verb: 'fire up',
      rest: 'spotify',
      exact: true,
    });
    expect(matchLeadingVerb('launch', verbs)).toEqual({ verb: 'launch', rest: '', exact: true });
  });

  it('tolerates typos in longer verbs when the first letter is right', () => {
    expect(matchLeadingVerb('opne notepad', verbs)).toEqual({
      verb: 'open',
      rest: 'notepad',
      exact: false,
    });
    expect(matchLeadingVerb('lanuch chrome', verbs)).toMatchObject({
      verb: 'launch',
      exact: false,
    });
  });

  it('rejects unrelated words and wrong first letters', () => {
    expect(matchLeadingVerb('pen notepad', ['open'])).toBeNull();
    expect(matchLeadingVerb('weather today', verbs)).toBeNull();
    expect(matchLeadingVerb('', verbs)).toBeNull();
    expect(matchLeadingVerb('open', ['fire up'])).toBeNull();
  });
});

describe('findNumber', () => {
  it.each([
    [['set', 'a', 'timer', 'for', '5', 'minutes'], 5, 4, 5],
    [['volume', 'to', '30'], 30, 2, 3],
    [['3.5', 'hours'], 3.5, 0, 1],
    [['1,000', 'meters'], 1000, 0, 1],
    [['for', 'five', 'minutes'], 5, 1, 2],
    [['twenty', 'five', 'percent'], 25, 0, 2],
    [['a', 'hundred', 'meters'], 100, 0, 2],
    [['one', 'hundred', 'and', 'five'], 105, 0, 4],
    [['two', 'thousand', 'three', 'hundred'], 2300, 0, 4],
  ])('finds the number in %j', (tokens, value, start, end) => {
    expect(findNumber(tokens)).toEqual({ value, start, end });
  });

  it('returns null without numbers and honours the start index', () => {
    expect(findNumber(['hello', 'world'])).toBeNull();
    expect(findNumber(['a', 'timer'])).toBeNull();
    expect(findNumber(['10', 'and', '20'], 1)).toEqual({ value: 20, start: 2, end: 3 });
  });

  it('does not read words that merely exist on every object as numbers', () => {
    expect(findNumber(['set', 'volume', 'to', 'constructor'])).toBeNull();
    expect(findNumber(['__proto__'])).toBeNull();
    expect(findNumber(['a', 'constructor'])).toBeNull();
    expect(findNumber(['twenty', 'and', 'constructor'])).toEqual({ value: 20, start: 0, end: 1 });
  });
});

describe('formatting helpers', () => {
  it('formats numbers compactly', () => {
    expect(formatNumber(360)).toBe('360');
    expect(formatNumber(1234567.891)).toBe('1,234,567.891');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });

  it('strips articles', () => {
    expect(stripArticles('the notepad')).toBe('notepad');
    expect(stripArticles('my calculator')).toBe('calculator');
    expect(stripArticles('notepad')).toBe('notepad');
  });
});

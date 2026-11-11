import { describe, expect, it } from 'vitest';
import type { ConversionCard, StatusCard } from '@shared/cards';
import { convertCommand } from '@main/commands/info/convert';
import type { ConvertSlots } from '@main/commands/info/convert';
import { matchOf, runContext } from '../helpers';

describe('convert: phrases', () => {
  it.each<[string, ConvertSlots]>([
    ['convert 5 km to miles', { value: 5, from: 'km', to: 'mi' }],
    ['10 pounds in kg', { value: 10, from: 'lb', to: 'kg' }],
    ['convert 100 fahrenheit to celsius', { value: 100, from: 'f', to: 'c' }],
    ['how many ounces in 2 pounds', { value: 2, from: 'lb', to: 'oz' }],
    ['50 celsius to kelvin', { value: 50, from: 'c', to: 'k' }],
    ['convert 2 gb to mb', { value: 2, from: 'gb', to: 'mb' }],
    ['how many feet in a mile', { value: 1, from: 'mi', to: 'ft' }],
    ['5 meters to feet', { value: 5, from: 'm', to: 'ft' }],
    ['5km to miles', { value: 5, from: 'km', to: 'mi' }],
    ["what's 5 km in miles", { value: 5, from: 'km', to: 'mi' }],
    ['convert five kilometres to miles', { value: 5, from: 'km', to: 'mi' }],
    ['how many cm in an inch', { value: 1, from: 'in', to: 'cm' }],
    ['convert 1 gib to mib', { value: 1, from: 'gib', to: 'mib' }],
    ['convert 5 kg to km', { value: 5, from: 'kg', to: 'km' }],
    ['please convert 10 lbs to kilos', { value: 10, from: 'lb', to: 'kg' }],
    ['Hey Beekeeper, convert 3 stone to kg', { value: 3, from: 'stone', to: 'kg' }],
  ])('%s', (text, slots) => {
    expect(matchOf(convertCommand, text)).toEqual({ slots, score: 0.95 });
  });

  it('repairs typos with a lower score', () => {
    expect(matchOf(convertCommand, 'convrt 5 km to miles')).toEqual({
      slots: { value: 5, from: 'km', to: 'mi' },
      score: 0.85,
    });
    expect(matchOf(convertCommand, '5 kilomters to miles')).toMatchObject({ score: 0.85 });
  });

  it.each([
    'what is the weather',
    'how many people are in the room',
    '10 minutes in seconds',
    'convert 5 km',
    '5 km',
    'miles to km',
    'convert',
    'set a timer for 5 minutes',
    'calculate 2 + 2',
    '5 constructor to km',
    'weather in paris',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(convertCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(convertCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of convertCommand.examples) {
      expect(matchOf(convertCommand, example), example).not.toBeNull();
    }
  });
});

describe('convert: answers', () => {
  const run = async (slots: ConvertSlots) => {
    const result = await convertCommand.run(slots, runContext());
    return { result, card: result.cards[0] as ConversionCard };
  };

  it.each<[ConvertSlots, string, string, string]>([
    [
      { value: 5, from: 'km', to: 'mi' },
      '5 kilometers',
      '3.1069 miles',
      '5 kilometers is 3.1069 miles.',
    ],
    [
      { value: 10, from: 'lb', to: 'kg' },
      '10 pounds',
      '4.5359 kilograms',
      '10 pounds is 4.5359 kilograms.',
    ],
    [
      { value: 100, from: 'f', to: 'c' },
      '100°F',
      '37.7778°C',
      '100 degrees Fahrenheit is 37.7778 degrees Celsius.',
    ],
    [{ value: 2, from: 'gb', to: 'mb' }, '2 GB', '2,000 MB', '2 gigabytes is 2,000 megabytes.'],
    [{ value: 1, from: 'mi', to: 'ft' }, '1 mile', '5,280 feet', '1 mile is 5,280 feet.'],
    [
      { value: 1, from: 'gib', to: 'mb' },
      '1 GiB',
      '1,073.7418 MB',
      '1 gibibyte is 1,073.7418 megabytes.',
    ],
    [
      { value: 0.5, from: 'mi', to: 'km' },
      '0.5 miles',
      '0.8047 kilometers',
      '0.5 miles is 0.8047 kilometers.',
    ],
    [
      { value: 1, from: 'mm', to: 'mi' },
      '1 millimeter',
      '0.0000006214 miles',
      '1 millimeter is 0.0000006214 miles.',
    ],
  ])('%j', async (slots, fromText, toText, speech) => {
    const { result, card } = await run(slots);
    expect(card).toMatchObject({
      kind: 'conversion',
      id: 'id-1',
      fromText,
      toText,
      copyText: toText,
    });
    expect(result.speech).toBe(speech);
  });

  it('reports the category of the conversion', async () => {
    expect((await run({ value: 1, from: 'kg', to: 'lb' })).card.category).toBe('weight');
    expect((await run({ value: 1, from: 'c', to: 'k' })).card.category).toBe('temperature');
    expect((await run({ value: 1, from: 'gb', to: 'mb' })).card.category).toBe('data');
    expect((await run({ value: 1, from: 'km', to: 'mi' })).card.category).toBe('length');
  });

  it('explains that different kinds of units cannot be converted', async () => {
    const { result } = await run({ value: 5, from: 'kg', to: 'km' });
    const card = result.cards[0] as StatusCard;
    expect(card).toMatchObject({
      kind: 'status',
      tone: 'warning',
      icon: 'convert',
      title: "I can't convert kilograms to kilometers",
      detail: 'kilograms measure weight, while kilometers measure length.',
    });
    expect(result.speech).toBe(
      "I can't convert kilograms to kilometers. kilograms measure weight, while kilometers measure length.",
    );
    const data = await run({ value: 1, from: 'gb', to: 'km' });
    expect((data.result.cards[0] as StatusCard).detail).toContain('data size');
  });

  it('refuses temperatures colder than absolute zero', async () => {
    const { result } = await run({ value: -300, from: 'c', to: 'k' });
    expect((result.cards[0] as StatusCard).title).toBe("That's below absolute zero");
    expect(result.speech).toBe("That's below absolute zero.");
  });

  it('fails loudly on unit ids it does not know', () => {
    expect(() => convertCommand.run({ value: 1, from: 'km', to: 'parsec' }, runContext())).toThrow(
      'parsec',
    );
    expect(() => convertCommand.run({ value: 1, from: 'cubit', to: 'km' }, runContext())).toThrow(
      'cubit',
    );
  });
});

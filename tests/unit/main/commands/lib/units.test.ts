import { describe, expect, it } from 'vitest';
import {
  UNITS,
  convertUnits,
  findUnit,
  formatQuantity,
  getUnit,
  parseConversion,
} from '@main/commands/lib/units';

function unit(id: string) {
  const found = getUnit(id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
}

function convert(value: number, from: string, to: string): number {
  const outcome = convertUnits(value, unit(from), unit(to));
  if (outcome.status !== 'ok') throw new Error(outcome.status);
  return outcome.value;
}

describe('unit table', () => {
  it('has no alias that belongs to two units', () => {
    const seen = new Map<string, string>();
    for (const entry of UNITS) {
      for (const alias of entry.aliases) {
        expect(seen.get(alias), `alias "${alias}"`).toBeUndefined();
        seen.set(alias, entry.id);
      }
    }
  });

  it.each([
    ['kilometres', 'km'],
    ['klicks', 'km'],
    ['lbs', 'lb'],
    ['pounds', 'lb'],
    ['kilos', 'kg'],
    ['gigs', 'gb'],
    ['°f', 'f'],
    ['fahrenheit', 'f'],
    ['centigrade', 'c'],
    ['degrees celsius', 'c'],
    ['celcius', 'c'],
    ['inches', 'in'],
    ['feet', 'ft'],
    ['nautical miles', 'nmi'],
    ['tons', 'tonne'],
    ['metric tonnes', 'tonne'],
    ['short tons', 'short-ton'],
    ['kibibytes', 'kib'],
    ['megabits', 'mbit'],
    ['stone', 'stone'],
    ['miles.', 'mi'],
  ])('recognises %s as %s', (phrase, id) => {
    expect(findUnit(phrase)).toMatchObject({ unit: { id }, exact: true });
  });

  it('tolerates typos in longer unit names but not in symbols', () => {
    expect(findUnit('kilomters')).toMatchObject({ unit: { id: 'km' }, exact: false });
    expect(findUnit('fahrenhiet')).toMatchObject({ unit: { id: 'f' }, exact: false });
    expect(findUnit('gms')).toMatchObject({ unit: { id: 'g' }, exact: true });
  });

  it.each(['', '   ', 'banana', 'square meters', 'to'])('does not know %j', (phrase) => {
    expect(findUnit(phrase)).toBeNull();
  });
});

describe('convertUnits', () => {
  it.each([
    [5, 'km', 'mi', 3.10685596],
    [10, 'lb', 'kg', 4.5359237],
    [1, 'mi', 'ft', 5280],
    [2, 'lb', 'oz', 32],
    [1, 'in', 'cm', 2.54],
    [12, 'in', 'ft', 1],
    [100, 'yd', 'm', 91.44],
    [1, 'nmi', 'km', 1.852],
    [3, 'stone', 'kg', 19.05087954],
    [1, 'tonne', 'kg', 1000],
    [1, 'short-ton', 'lb', 2000],
    [500, 'mg', 'g', 0.5],
    [2, 'gb', 'mb', 2000],
    [1, 'gib', 'mib', 1024],
    [1, 'kib', 'byte', 1024],
    [1, 'kb', 'byte', 1000],
    [1, 'byte', 'bit', 8],
    [100, 'mbit', 'mb', 12.5],
    [1, 'tb', 'gb', 1000],
    [1, 'tib', 'gib', 1024],
  ])('%s %s = %s %s', (amount, from, to, expected) => {
    expect(convert(amount, from, to)).toBeCloseTo(expected, 6);
  });

  it.each([
    [100, 'f', 'c', 37.7777777778],
    [0, 'c', 'f', 32],
    [100, 'c', 'f', 212],
    [50, 'c', 'k', 323.15],
    [300, 'k', 'c', 26.85],
    [32, 'f', 'k', 273.15],
    [273.15, 'k', 'f', 32],
    [-40, 'f', 'c', -40],
    [20, 'c', 'c', 20],
  ])('temperature: %s %s = %s %s', (amount, from, to, expected) => {
    expect(convert(amount, from, to)).toBeCloseTo(expected, 8);
  });

  it('refuses to mix categories', () => {
    expect(convertUnits(5, unit('km'), unit('lb'))).toEqual({ status: 'incompatible' });
    expect(convertUnits(5, unit('c'), unit('kg'))).toEqual({ status: 'incompatible' });
  });

  it('refuses temperatures below absolute zero', () => {
    expect(convertUnits(-300, unit('c'), unit('k'))).toEqual({ status: 'below-absolute-zero' });
    expect(convertUnits(-500, unit('f'), unit('c'))).toEqual({ status: 'below-absolute-zero' });
    expect(convertUnits(-5, unit('k'), unit('c'))).toEqual({ status: 'below-absolute-zero' });
    expect(convertUnits(-273.15, unit('c'), unit('k'))).toMatchObject({ status: 'ok', value: 0 });
  });
});

describe('formatQuantity', () => {
  it('writes names, symbols and plurals', () => {
    expect(formatQuantity(1, unit('mi'))).toBe('1 mile');
    expect(formatQuantity(3.106856, unit('mi'))).toBe('3.1069 miles');
    expect(formatQuantity(100, unit('f'))).toBe('100°F');
    expect(formatQuantity(2, unit('gb'))).toBe('2 GB');
    expect(formatQuantity(0.000621371, unit('mi'))).toBe('0.0006214 miles');
    expect(formatQuantity(1234567.891, unit('m'))).toBe('1,234,567.891 meters');
    expect(formatQuantity(1, unit('stone'))).toBe('1 stone');
  });

  it('spells units out when spoken', () => {
    expect(formatQuantity(100, unit('f'), { spoken: true })).toBe('100 degrees Fahrenheit');
    expect(formatQuantity(1, unit('c'), { spoken: true })).toBe('1 degree Celsius');
    expect(formatQuantity(2, unit('gb'), { spoken: true })).toBe('2 gigabytes');
    expect(formatQuantity(5, unit('k'), { spoken: true })).toBe('5 kelvin');
  });

  it('honours the requested precision', () => {
    expect(formatQuantity(2.5, unit('km'), { fractionDigits: 6 })).toBe('2.5 kilometers');
    expect(formatQuantity(1 / 3, unit('km'), { fractionDigits: 2 })).toBe('0.33 kilometers');
  });
});

describe('parseConversion', () => {
  it.each([
    ['convert 5 km to miles', 5, 'km', 'mi'],
    ['10 pounds in kg', 10, 'lb', 'kg'],
    ['convert 100 fahrenheit to celsius', 100, 'f', 'c'],
    ['how many ounces in 2 pounds', 2, 'lb', 'oz'],
    ['50 celsius to kelvin', 50, 'c', 'k'],
    ['convert 2 gb to mb', 2, 'gb', 'mb'],
    ['how many feet in a mile', 1, 'mi', 'ft'],
    ['5 meters to feet', 5, 'm', 'ft'],
    ['5km to miles', 5, 'km', 'mi'],
    ['100°f to celsius', 100, 'f', 'c'],
    ['100 °c to °f', 100, 'c', 'f'],
    ['what is 5 miles in km', 5, 'mi', 'km'],
    ["what's 100 fahrenheit in celsius", 100, 'f', 'c'],
    ['how much is 3 gigabytes in megabytes', 3, 'gb', 'mb'],
    ['convert five kilometers to miles', 5, 'km', 'mi'],
    ['convert a mile to kilometers', 1, 'mi', 'km'],
    ['convert an inch to cm', 1, 'in', 'cm'],
    ['convert twenty five kg to pounds', 25, 'kg', 'lb'],
    ['how many cm in an inch', 1, 'in', 'cm'],
    ['how many km are in 5 miles', 5, 'mi', 'km'],
    ['how many pounds is 10 kg', 10, 'kg', 'lb'],
    ['how many feet are in a mile', 1, 'mi', 'ft'],
    ['12 in to cm', 12, 'in', 'cm'],
    ['5 cm to in', 5, 'cm', 'in'],
    ['-40 f to c', -40, 'f', 'c'],
    ['minus 10 celsius to fahrenheit', -10, 'c', 'f'],
    ['half a mile in km', 0.5, 'mi', 'km'],
    ['1,000 meters to km', 1000, 'm', 'km'],
    ['2.5 kilograms to pounds', 2.5, 'kg', 'lb'],
    ['convert miles to km', 1, 'mi', 'km'],
    ['change 5 km into miles', 5, 'km', 'mi'],
    ['2 tons to pounds', 2, 'tonne', 'lb'],
    ['1 tib in gib', 1, 'tib', 'gib'],
    ['3 stone in kg', 3, 'stone', 'kg'],
    ['10 kg = lbs', 10, 'kg', 'lb'],
  ])('%s', (text, value, from, to) => {
    expect(parseConversion(text)).toMatchObject({ value, from: { id: from }, to: { id: to } });
  });

  it('flags unit typos as inexact', () => {
    expect(parseConversion('5 kilomters to miles')).toMatchObject({ exact: false });
    expect(parseConversion('5 km to miles')).toMatchObject({ exact: true });
  });

  it('reports categories that do not match so the command can explain', () => {
    expect(parseConversion('convert 5 kg to km')).toMatchObject({
      from: { category: 'weight' },
      to: { category: 'length' },
    });
  });

  it.each([
    '',
    'convert',
    'convert 5 km',
    '5 km',
    'miles to km',
    'how many people are in the room',
    'how many',
    '10 minutes in seconds',
    '5 to 10',
    'what is the weather',
    'convert 5 km to miles and back',
    'weather in paris',
  ])('does not treat %j as a conversion', (text) => {
    expect(parseConversion(text)).toBeNull();
  });
});

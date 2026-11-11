import { fuzzyWord } from './fuzzy';
import { findNumberSafe, formatValue } from './numbers';

export type UnitCategory = 'length' | 'weight' | 'temperature' | 'data';

export interface UnitDef {
  id: string;
  category: UnitCategory;
  /** Size of one unit in the category's base unit (metre, gram, byte). Unused for temperature. */
  factor: number;
  singular: string;
  plural: string;
  /** Compact form such as "km" or "°C". */
  symbol: string;
  /** Data sizes and temperatures read better as "2 GB" / "100°F" than as long names. */
  useSymbol: boolean;
  aliases: readonly string[];
}

function unit(
  id: string,
  category: UnitCategory,
  factor: number,
  names: readonly [singular: string, plural: string, symbol: string],
  aliases: readonly string[],
  useSymbol = false,
): UnitDef {
  const [singular, plural, symbol] = names;
  return { id, category, factor, singular, plural, symbol, useSymbol, aliases };
}

export const UNITS: readonly UnitDef[] = [
  unit(
    'mm',
    'length',
    0.001,
    ['millimeter', 'millimeters', 'mm'],
    ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'],
  ),
  unit(
    'cm',
    'length',
    0.01,
    ['centimeter', 'centimeters', 'cm'],
    ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
  ),
  unit('m', 'length', 1, ['meter', 'meters', 'm'], ['m', 'meter', 'meters', 'metre', 'metres']),
  unit(
    'km',
    'length',
    1000,
    ['kilometer', 'kilometers', 'km'],
    ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'klick', 'klicks'],
  ),
  unit('in', 'length', 0.0254, ['inch', 'inches', 'in'], ['in', 'inch', 'inches']),
  unit('ft', 'length', 0.3048, ['foot', 'feet', 'ft'], ['ft', 'foot', 'feet']),
  unit('yd', 'length', 0.9144, ['yard', 'yards', 'yd'], ['yd', 'yds', 'yard', 'yards']),
  unit('mi', 'length', 1609.344, ['mile', 'miles', 'mi'], ['mi', 'mile', 'miles']),
  unit(
    'nmi',
    'length',
    1852,
    ['nautical mile', 'nautical miles', 'nmi'],
    ['nmi', 'nautical mile', 'nautical miles'],
  ),

  unit(
    'mg',
    'weight',
    0.001,
    ['milligram', 'milligrams', 'mg'],
    ['mg', 'mgs', 'milligram', 'milligrams', 'milligramme', 'milligrammes'],
  ),
  unit(
    'g',
    'weight',
    1,
    ['gram', 'grams', 'g'],
    ['g', 'gm', 'gms', 'gram', 'grams', 'gramme', 'grammes'],
  ),
  unit(
    'kg',
    'weight',
    1000,
    ['kilogram', 'kilograms', 'kg'],
    ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes'],
  ),
  unit('oz', 'weight', 28.349523125, ['ounce', 'ounces', 'oz'], ['oz', 'ounce', 'ounces']),
  unit('lb', 'weight', 453.59237, ['pound', 'pounds', 'lb'], ['lb', 'lbs', 'pound', 'pounds']),
  unit('stone', 'weight', 6350.29318, ['stone', 'stone', 'st'], ['stone', 'stones']),
  unit(
    'tonne',
    'weight',
    1_000_000,
    ['tonne', 'tonnes', 't'],
    [
      'tonne',
      'tonnes',
      'ton',
      'tons',
      'metric ton',
      'metric tons',
      'metric tonne',
      'metric tonnes',
    ],
  ),
  unit(
    'short-ton',
    'weight',
    907_184.74,
    ['short ton', 'short tons', 'ton'],
    ['short ton', 'short tons', 'us ton', 'us tons'],
  ),

  unit(
    'c',
    'temperature',
    1,
    ['degree Celsius', 'degrees Celsius', '°C'],
    [
      'c',
      '°c',
      'celsius',
      'celcius',
      'centigrade',
      'degree celsius',
      'degrees celsius',
      'degree c',
      'degrees c',
      'deg c',
      'degrees centigrade',
    ],
    true,
  ),
  unit(
    'f',
    'temperature',
    1,
    ['degree Fahrenheit', 'degrees Fahrenheit', '°F'],
    [
      'f',
      '°f',
      'fahrenheit',
      'farenheit',
      'fahrenheight',
      'degree fahrenheit',
      'degrees fahrenheit',
      'degree f',
      'degrees f',
      'deg f',
    ],
    true,
  ),
  unit(
    'k',
    'temperature',
    1,
    ['kelvin', 'kelvin', 'K'],
    ['k', '°k', 'kelvin', 'kelvins', 'degrees kelvin', 'degree kelvin'],
    true,
  ),

  unit('bit', 'data', 0.125, ['bit', 'bits', 'bit'], ['bit', 'bits'], true),
  unit('byte', 'data', 1, ['byte', 'bytes', 'B'], ['byte', 'bytes'], true),
  unit('kb', 'data', 1e3, ['kilobyte', 'kilobytes', 'KB'], ['kb', 'kilobyte', 'kilobytes'], true),
  unit(
    'mb',
    'data',
    1e6,
    ['megabyte', 'megabytes', 'MB'],
    ['mb', 'meg', 'megs', 'megabyte', 'megabytes'],
    true,
  ),
  unit(
    'gb',
    'data',
    1e9,
    ['gigabyte', 'gigabytes', 'GB'],
    ['gb', 'gig', 'gigs', 'gigabyte', 'gigabytes'],
    true,
  ),
  unit('tb', 'data', 1e12, ['terabyte', 'terabytes', 'TB'], ['tb', 'terabyte', 'terabytes'], true),
  unit('pb', 'data', 1e15, ['petabyte', 'petabytes', 'PB'], ['pb', 'petabyte', 'petabytes'], true),
  unit(
    'kib',
    'data',
    1024,
    ['kibibyte', 'kibibytes', 'KiB'],
    ['kib', 'kibibyte', 'kibibytes'],
    true,
  ),
  unit(
    'mib',
    'data',
    1024 ** 2,
    ['mebibyte', 'mebibytes', 'MiB'],
    ['mib', 'mebibyte', 'mebibytes'],
    true,
  ),
  unit(
    'gib',
    'data',
    1024 ** 3,
    ['gibibyte', 'gibibytes', 'GiB'],
    ['gib', 'gibibyte', 'gibibytes'],
    true,
  ),
  unit(
    'tib',
    'data',
    1024 ** 4,
    ['tebibyte', 'tebibytes', 'TiB'],
    ['tib', 'tebibyte', 'tebibytes'],
    true,
  ),
  unit(
    'kbit',
    'data',
    125,
    ['kilobit', 'kilobits', 'kbit'],
    ['kbit', 'kbits', 'kilobit', 'kilobits'],
    true,
  ),
  unit(
    'mbit',
    'data',
    125_000,
    ['megabit', 'megabits', 'Mbit'],
    ['mbit', 'mbits', 'megabit', 'megabits'],
    true,
  ),
  unit(
    'gbit',
    'data',
    125_000_000,
    ['gigabit', 'gigabits', 'Gbit'],
    ['gbit', 'gbits', 'gigabit', 'gigabits'],
    true,
  ),
];

const BY_ALIAS = new Map<string, UnitDef>(
  UNITS.flatMap((entry) => entry.aliases.map((alias): [string, UnitDef] => [alias, entry])),
);
const BY_ID = new Map<string, UnitDef>(UNITS.map((entry) => [entry.id, entry]));

export function getUnit(id: string): UnitDef | undefined {
  return BY_ID.get(id);
}

/** Aliases long enough to be matched through typo tolerance. */
const FUZZY_ALIASES = [...BY_ALIAS.keys()].filter((alias) => alias.length >= 5);

interface UnitMatch {
  unit: UnitDef;
  /** False when the unit was recognised through typo tolerance. */
  exact: boolean;
}

/** Finds a unit by name, symbol or common misspelling ("kilometres", "lbs", "celcius"). */
export function findUnit(phrase: string): UnitMatch | null {
  const key = phrase.trim().replace(/\.$/, '').replace(/\s+/g, ' ');
  if (key.length === 0) return null;
  const direct =
    BY_ALIAS.get(key) ?? (key.endsWith('s') ? BY_ALIAS.get(key.slice(0, -1)) : undefined);
  if (direct) return { unit: direct, exact: true };
  if (key.includes(' ')) return null;
  const alias = FUZZY_ALIASES.find((candidate) => fuzzyWord(key, candidate));
  const fuzzy = alias === undefined ? undefined : BY_ALIAS.get(alias);
  return fuzzy ? { unit: fuzzy, exact: false } : null;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

type ConversionOutcome =
  { status: 'ok'; value: number } | { status: 'incompatible' } | { status: 'below-absolute-zero' };

function toCelsius(value: number, from: UnitDef): number {
  if (from.id === 'f') return ((value - 32) * 5) / 9;
  if (from.id === 'k') return value - 273.15;
  return value;
}

function fromCelsius(celsius: number, to: UnitDef): number {
  if (to.id === 'f') return (celsius * 9) / 5 + 32;
  if (to.id === 'k') return celsius + 273.15;
  return celsius;
}

export function convertUnits(value: number, from: UnitDef, to: UnitDef): ConversionOutcome {
  if (from.category !== to.category) return { status: 'incompatible' };
  if (from.category === 'temperature') {
    const celsius = toCelsius(value, from);
    if (celsius < -273.15 - 1e-9) return { status: 'below-absolute-zero' };
    return { status: 'ok', value: Number(fromCelsius(celsius, to).toPrecision(12)) };
  }
  return { status: 'ok', value: Number(((value * from.factor) / to.factor).toPrecision(12)) };
}

/** "3.1069 miles", "100°F", "2 GB"; with `spoken` the unit is always written out in words. */
export function formatQuantity(
  value: number,
  entry: UnitDef,
  options: { fractionDigits?: number; spoken?: boolean } = {},
): string {
  const text = formatValue(value, options.fractionDigits ?? 4);
  if (!options.spoken) {
    if (entry.category === 'temperature') return `${text}${entry.symbol}`;
    if (entry.useSymbol) return `${text} ${entry.symbol}`;
  }
  return `${text} ${text === '1' ? entry.singular : entry.plural}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface ConversionRequest {
  value: number;
  from: UnitDef;
  to: UnitDef;
  /** False when a unit was recognised through typo tolerance. */
  exact: boolean;
}

interface Quantity {
  value: number;
  unit: UnitDef;
  exact: boolean;
}

const CONVERT_VERB =
  /^(?:(?:convert|change|turn|translate|express|work out)\s+(?:me\s+)?|(?:what is|what's|whats|what are|how much is|how much are|how much|calculate|tell me|give me|show me)\s+)/;
const CONNECTORS = new Set(['to', 'into', 'in', 'as', 'equals', 'equal', '=']);

function parseQuantity(tokens: readonly string[], requireNumber: boolean): Quantity | null {
  let index = 0;
  let sign = 1;
  if (tokens[0] === 'minus' || tokens[0] === 'negative') {
    sign = -1;
    index = 1;
  }

  let value = 1;
  const number = findNumberSafe(tokens, index);
  if (number !== null && number.start === index) {
    value = number.value;
    index = number.end;
  } else if (tokens[index] === 'a' || tokens[index] === 'an') {
    index += 1;
  } else if (tokens[index] === 'half') {
    value = 0.5;
    index += 1;
    if (tokens[index] === 'a' || tokens[index] === 'an') index += 1;
  } else if (requireNumber) {
    return null;
  }

  const match = findUnit(tokens.slice(index).join(' '));
  return match ? { value: sign * value, unit: match.unit, exact: match.exact } : null;
}

/**
 * Understands "convert 5 km to miles", "10 pounds in kg", "what is 100 fahrenheit in celsius",
 * "how many feet in a mile" and "5km to mi". Expects normalised (lower-case) text.
 */
export function parseConversion(text: string): ConversionRequest | null {
  const spaced = text.replace(/(\d)(?=[a-z°])/g, '$1 ');

  const many = /^how many (.+?) (?:(?:are|is) )?(?:there )?(?:in|per|is|are|equals?) (.+)$/.exec(
    spaced,
  );
  if (many) {
    const target = findUnit(many[1] ?? '');
    const source = parseQuantity((many[2] ?? '').split(' '), false);
    if (target && source) {
      return {
        value: source.value,
        from: source.unit,
        to: target.unit,
        exact: target.exact && source.exact,
      };
    }
    return null;
  }

  const verb = CONVERT_VERB.exec(spaced);
  const explicitConvert =
    verb !== null && /^(?:convert|change|turn|translate|express)/.test(verb[0]);
  const tokens = (verb ? spaced.slice(verb[0].length) : spaced).split(' ');
  for (let split = 1; split < tokens.length - 1; split += 1) {
    if (!CONNECTORS.has(tokens[split] ?? '')) continue;
    const source = parseQuantity(tokens.slice(0, split), !explicitConvert);
    const target = findUnit(tokens.slice(split + 1).join(' '));
    if (source && target) {
      return {
        value: source.value,
        from: source.unit,
        to: target.unit,
        exact: source.exact && target.exact,
      };
    }
  }
  return null;
}

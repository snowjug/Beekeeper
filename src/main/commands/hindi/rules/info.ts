/** Rules for the information commands: time, weather, battery, system info, maths, units, dictionary. */
import type { Tok } from '../pipeline';
import { NOISE, type Utterance } from '../utterance';
import { accounted, findPlace, type Rule } from './common';

// ---------------------------------------------------------------------------
// Time and date: "समय क्या हुआ है", "आज की तारीख", "टोक्यो में कितने बजे हैं"
// ---------------------------------------------------------------------------

const TIME_ALLOWED = [
  'TIME',
  'BAJE',
  'DATE',
  'DAY',
  'NOW',
  'WHAT',
  'HOWMUCH',
  'WHICH',
  'TELL',
  'TODAY',
  'KA',
  'IN',
  'I',
  'FOR',
  'HERE',
  'WENT',
];

export const timeRule: Rule = (u) => {
  if (!u.has('TIME', 'BAJE', 'DATE', 'DAY') || u.has('NO', 'PAST')) return null;
  const place = findPlace(u);
  if (!accounted(u, TIME_ALLOWED, place?.indices)) return null;
  const where = place === null ? '' : ` in ${place.name}`;
  if (u.has('DATE')) return `what's the date${where}`;
  if (u.has('DAY') && !u.has('TIME', 'BAJE')) return `what day is it${where}`;
  return `what time is it${where}`;
};

// ---------------------------------------------------------------------------
// Weather: "मुंबई में मौसम कैसा है", "कल बारिश होगी क्या", "कितनी गर्मी है"
// ---------------------------------------------------------------------------

const WEATHER_KINDS = [
  'WEATHER',
  'RAIN',
  'SNOW',
  'HOT',
  'COLD',
  'TEMP',
  'UMBRELLA',
  'STORM',
  'SUNNY',
  'CLOUDY',
  'WINDY',
  'FORECAST',
];
const WEATHER_ALLOWED = [
  ...WEATHER_KINDS,
  'WHAT',
  'HOW',
  'HOWMUCH',
  'TELL',
  'NOW',
  'FUT',
  'KA',
  'KO',
  'INFO',
  'ME',
  'MY',
  'ABOUT',
  'FOR',
  'CHANCE',
  'WATER',
  'TAKE',
  'IN',
  'I',
  'ON',
  'HERE',
  'THAT',
  'TODAY',
  'TOMORROW',
  'DAYAFTER',
  'DAYW',
  'WEEKEND',
  'NIGHT',
  'MORNING',
  'EVENING',
  'NOON',
  'OUTSIDE',
];
const DAY_SYMS = ['TODAY', 'TOMORROW', 'DAYAFTER', 'DAYW', 'WEEKEND'];
const PART_SYMS = ['MORNING', 'EVENING', 'NIGHT', 'NOON'];
const PART_WORDS: Readonly<Record<string, string>> = {
  MORNING: 'morning',
  EVENING: 'evening',
  NIGHT: 'night',
  NOON: 'afternoon',
};

/** The day a weather question is about, as English ("tomorrow", "on friday", "tonight"); "" = today. */
function weatherDay(u: Utterance): string | null {
  const days = u.toks.filter((token) => DAY_SYMS.includes(token.sym));
  const parts = u.toks.filter((token) => PART_SYMS.includes(token.sym));
  if (days.length > 1 || parts.length > 1) return null;
  const part = parts[0]?.sym;
  const day = days[0];
  if (day === undefined || day.sym === 'TODAY') {
    if (part === undefined) return '';
    return part === 'NIGHT' ? 'tonight' : `this ${PART_WORDS[part] ?? 'morning'}`;
  }
  switch (day.sym) {
    case 'TOMORROW':
      return part === undefined ? 'tomorrow' : `tomorrow ${PART_WORDS[part] ?? ''}`.trim();
    case 'DAYAFTER':
      return 'day after tomorrow';
    case 'DAYW':
      return `on ${day.payload ?? ''}`;
    default:
      return 'this weekend';
  }
}

export const weatherRule: Rule = (u) => {
  if (!u.has(...WEATHER_KINDS) || u.has('NO', 'PAST')) return null;
  const place = findPlace(u, ['IN', 'KA', 'I', 'WEATHER', 'FORECAST', 'TEMP']);
  if (!accounted(u, WEATHER_ALLOWED, place?.indices)) return null;
  const day = weatherDay(u);
  if (day === null) return null;
  const tail = `${place === null ? '' : ` in ${place.name}`}${day === '' ? '' : ` ${day}`}`;

  if (u.has('UMBRELLA')) return `do i need an umbrella${tail}`;
  if (u.has('SNOW')) return `will it snow${tail}`;
  if (u.has('RAIN')) return `will it rain${tail}`;
  if (u.has('STORM')) return `will there be a storm${tail}`;
  if (u.has('TEMP')) return `what is the temperature${tail}`;
  if (u.has('HOT')) return `how hot is it${tail}`;
  if (u.has('COLD')) return `how cold is it${tail}`;
  if (u.has('SUNNY')) return `will it be sunny${tail}`;
  if (u.has('CLOUDY')) return `will it be cloudy${tail}`;
  if (u.has('WINDY')) return `will it be windy${tail}`;
  return `what's the weather like${tail}`;
};

const FOLLOW_UP_ALLOWED = [
  'AND',
  'WHAT',
  'HOW',
  'FUT',
  'KA',
  'KO',
  'IN',
  'I',
  'ON',
  'NOW',
  'TODAY',
  'TOMORROW',
  'DAYAFTER',
  'DAYW',
  'WEEKEND',
  'NIGHT',
  'MORNING',
  'EVENING',
  'NOON',
];

/** "और कल?", "कल का क्या?", "और मुंबई में?": a short follow-up to a weather answer. */
export const weatherFollowUpRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || u.has(...WEATHER_KINDS)) return null;
  const asks = u.has('AND', 'HOW') || (u.has('KA') && u.has('WHAT'));
  if (!asks) return null;
  const place = findPlace(u, ['IN', 'KA', 'I']);
  if (!accounted(u, FOLLOW_UP_ALLOWED, place?.indices)) return null;
  const day = weatherDay(u)?.replace(/^on /, '') ?? null;
  if (day === null || (place === null && day === '')) return null;
  return `what about${place === null ? '' : ` ${place.name}`}${day === '' ? '' : ` ${day}`}`;
};

// ---------------------------------------------------------------------------
// Battery and system information
// ---------------------------------------------------------------------------

const BATTERY_ALLOWED = [
  'BATTERY',
  'CHARGE',
  'HOWMUCH',
  'LEFT',
  'TELL',
  'WHAT',
  'NOW',
  'MY',
  'KA',
  'PERCENT',
  'PC',
  'INFO',
  'ME',
  'IN',
  'HOW',
  'TODAY',
  'FUT',
  'DER',
];

export const batteryRule: Rule = (u) => {
  if (!u.has('BATTERY', 'CHARGE') || u.has('NO', 'PAST')) return null;
  // "चार्ज में लगा है क्या": plugged in and charging?
  const plugged = u.has('SET') && u.has('WHAT') && u.has('CHARGE');
  if (!accounted(u, plugged ? [...BATTERY_ALLOWED, 'SET'] : BATTERY_ALLOWED)) return null;
  return u.has('CHARGE') ? 'is my laptop charging' : 'how much battery do i have left';
};

const SYSTEM_ALLOWED = [
  'PC',
  'INFO',
  'CPU',
  'RAM',
  'DISK',
  'SPACE',
  'FREE',
  'EMPTY',
  'LEFT',
  'USAGE',
  'HOWMUCH',
  'TELL',
  'WHAT',
  'KA',
  'MY',
  'ME',
  'NOW',
  'ABOUT',
  'IN',
  'HOW',
];
const UPTIME_ALLOWED = [
  'PC',
  'START',
  'WHEN',
  'FROM',
  'DER',
  'HOWMUCH',
  'TIME',
  'WHAT',
  'MY',
  'KA',
  'TELL',
  'NOW',
  'ME',
];

export const systemInfoRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const uptimeAsked = u.has('WHEN', 'DER') || (u.has('HOWMUCH') && u.has('TIME'));
  if (u.has('START') && u.has('FROM') && uptimeAsked && accounted(u, UPTIME_ALLOWED)) {
    return 'how long has my pc been on';
  }
  if (!u.has('PC', 'CPU', 'RAM', 'DISK', 'SPACE') || !accounted(u, SYSTEM_ALLOWED)) return null;

  const cpu = u.has('CPU');
  const ram = u.has('RAM');
  const disk = u.has('DISK') || (u.has('SPACE') && u.has('FREE', 'LEFT', 'HOWMUCH'));
  if (cpu && !ram && !disk) return 'cpu usage';
  if (ram && !cpu && !disk) return 'how much ram do i have';
  if (disk && !cpu && !ram) return 'how much disk space is free';
  if (cpu || ram || disk) return 'system info';
  if (u.has('INFO')) return 'system info';
  return u.has('ABOUT') ? 'about my pc' : null;
};

// ---------------------------------------------------------------------------
// Calculator: "5 गुणा 6 कितना होता है", "2400 का 15 प्रतिशत", "144 का वर्गमूल"
// ---------------------------------------------------------------------------

const OPERATORS: Readonly<Record<string, string>> = {
  PLUS: 'plus',
  MINUS: 'minus',
  TIMES: 'times',
  DIV: 'divided by',
  POWER: 'to the power of',
};
const CALC_FRAME: ReadonlySet<string> = new Set([
  ...NOISE,
  'WHAT',
  'HOWMUCH',
  'CALC',
  'TELL',
  'EQUALS',
  'FUT',
  'NOW',
  'ME',
]);

const num = (token: Tok | undefined): string => String(token?.value ?? 0);

/** The English maths phrase for the numbers and operators of an utterance, or null. */
function expressionOf(tokens: readonly Tok[]): string | null {
  const pattern = tokens.map((token) => token.sym).join(' ');
  const at = (index: number): Tok | undefined => tokens[index];

  if (/^NUM(?: (?:KA )?(?:PLUS|MINUS|TIMES|DIV|POWER) NUM)+$/.test(pattern)) {
    return tokens
      .filter((token) => token.sym !== 'KA')
      .map((token) => (token.sym === 'NUM' ? num(token) : (OPERATORS[token.sym] ?? '')))
      .join(' ');
  }
  if (/^NUM AND NUM(?: KA)? (?:PLUS|TIMES)$/.test(pattern)) {
    return `${num(at(0))} ${OPERATORS[tokens[tokens.length - 1]?.sym ?? ''] ?? ''} ${num(at(2))}`;
  }
  if (/^NUM (?:IN|FROM)(?: FROM)? NUM (?:PLUS|DEC|MINUS)$/.test(pattern)) {
    const plus = tokens[tokens.length - 1]?.sym === 'PLUS';
    return `${num(at(0))} ${plus ? 'plus' : 'minus'} ${num(tokens.find((t, i) => i > 0 && t.sym === 'NUM'))}`;
  }
  if (/^NUM (?:KO|KA) NUM (?:FROM )?(?:TIMES|DIV)$/.test(pattern)) {
    const op = OPERATORS[tokens[tokens.length - 1]?.sym ?? ''] ?? '';
    return `${num(at(0))} ${op} ${num(at(2))}`;
  }
  if (/^NUM KA NUM PERCENT$/.test(pattern)) return `${num(at(2))}% of ${num(at(0))}`;
  if (/^NUM PERCENT (?:KA )?NUM$/.test(pattern)) {
    return `${num(at(0))}% of ${num(tokens.find((t, i) => i > 1 && t.sym === 'NUM'))}`;
  }
  if (/^NUM PERCENT NUM KA$/.test(pattern)) return `${num(at(0))}% of ${num(at(2))}`;
  const root = /^(?:NUM KA (SQRT|CBRT)|(SQRT|CBRT) (?:KA )?NUM)$/.exec(pattern);
  if (root !== null) {
    const kind = root[1] ?? root[2];
    const value = num(tokens.find((token) => token.sym === 'NUM'));
    return `${kind === 'SQRT' ? 'square' : 'cube'} root of ${value}`;
  }
  if (/^NUM KA SQUARE$/.test(pattern)) return `${num(at(0))} squared`;
  if (/^NUM KA CUBE$/.test(pattern)) return `${num(at(0))} cubed`;
  return null;
}

export const calculateRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || !u.has('NUM')) return null;
  const tokens = u.toks
    .filter((token) => !CALC_FRAME.has(token.sym))
    .map((token, index, all) =>
      token.sym === 'DEC' && all[index - 1]?.sym === 'NUM' && all[index + 1]?.sym === 'NUM'
        ? { ...token, sym: 'MINUS' }
        : token,
    );
  const expression = expressionOf(tokens);
  return expression === null ? null : `what is ${expression}`;
};

// ---------------------------------------------------------------------------
// Unit conversion: "10 किलोमीटर कितने मील हैं", "100 फ़ारेनहाइट को सेल्सियस में बदलो"
// ---------------------------------------------------------------------------

const CONVERT_ALLOWED = [
  'NUM',
  'UNIT',
  'IN',
  'KO',
  'HOWMUCH',
  'CONVERT',
  'CHANGE',
  'WHAT',
  'TELL',
  'FROM',
  'KA',
  'CALC',
  'EQUALS',
  'ME',
  'FOR',
  'AND',
];

export const convertRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || u.count('NUM') !== 1 || u.count('UNIT') !== 2) return null;
  if (!accounted(u, CONVERT_ALLOWED)) return null;
  const numberAt = u.indexOf('NUM');
  const source = u.toks[numberAt + 1];
  if (source?.sym !== 'UNIT') return null;
  const target = u.toks.find((token, index) => token.sym === 'UNIT' && index !== numberAt + 1);
  if (target === undefined) return null;
  return `convert ${num(u.toks[numberAt])} ${source.payload ?? ''} to ${target.payload ?? ''}`;
};

// ---------------------------------------------------------------------------
// Dictionary: "serendipity का मतलब क्या है"
// ---------------------------------------------------------------------------

const DEFINE_ALLOWED = ['MEANING', 'W', 'KA', 'WHAT', 'HOWMUCH', 'TELL', 'WORD', 'ME', 'NOW'];

export const defineRule: Rule = (u) => {
  if (!u.has('MEANING') || u.has('NO', 'PAST') || !accounted(u, DEFINE_ALLOWED)) return null;
  const words = u.toks.filter((token) => token.sym === 'W');
  const [word] = words;
  if (words.length !== 1 || word === undefined || word.kind !== 'lat') return null;
  return `define ${word.text.toLowerCase()}`;
};

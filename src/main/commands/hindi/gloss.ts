/**
 * Word-by-word translation for sentences that mix English and Hindi in English word order
 * ("set a timer for पाँच मिनट", "volume बढ़ाओ"): Latin words stay, Hindi words and numbers become
 * their English counterparts, Hindi function words drop out. Only a last resort, run when no
 * command rule recognised the sentence.
 */
import type { Tok } from './pipeline';
import { englishTime } from './pipeline';
import type { Utterance } from './utterance';

const GLOSS: Readonly<Record<string, string>> = {
  OPEN: 'open',
  SET: 'set',
  START: 'start',
  TURN: 'turn',
  PLAY: 'play',
  INC: 'up',
  DEC: 'down',
  OFF: 'off',
  TELL: 'show',
  DEL: 'delete',
  CANCEL: 'cancel',
  SEARCH: 'search',
  CALC: 'calculate',
  COPY: 'copy',
  WRITE: 'write',
  TIMER: 'timer',
  ALARM: 'alarm',
  REMINDER: 'reminder',
  NOTE: 'note',
  NOTES: 'notes',
  VOLUME: 'volume',
  BRIGHT: 'brightness',
  MUTE: 'mute',
  UNMUTE: 'unmute',
  DARK: 'dark',
  LIGHTM: 'light',
  MODE: 'mode',
  THEME: 'theme',
  SCREEN: 'screen',
  SCREENSHOT: 'screenshot',
  LOCK: 'lock',
  SHUTDOWN: 'shutdown',
  RESTART: 'restart',
  SLEEPM: 'sleep',
  BATTERY: 'battery',
  CPU: 'cpu',
  RAM: 'ram',
  DISK: 'disk',
  WEATHER: 'weather',
  RAIN: 'rain',
  TEMP: 'temperature',
  TIME: 'time',
  DATE: 'date',
  DAY: 'day',
  TODAY: 'today',
  TOMORROW: 'tomorrow',
  WIFI: 'wifi',
  BLUETOOTH: 'bluetooth',
  SETTINGS: 'settings',
  HELP: 'help',
  RECYCLE: 'recycle bin',
  EMPTY: 'empty',
  PLUS: 'plus',
  MINUS: 'minus',
  TIMES: 'times',
  DIV: 'divided by',
  PERCENT: 'percent',
};

/** English function words kept when they were typed in Latin script. */
const ENGLISH_PASS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'to',
  'for',
  'in',
  'on',
  'at',
  'of',
  'me',
  'my',
  'it',
  'this',
  'that',
  'and',
  'or',
  'is',
  'are',
  'what',
  'how',
  'will',
  'do',
  'i',
  'by',
  'from',
  'about',
]);
const VALUE_SYMS: ReadonlySet<string> = new Set([
  'NUM',
  'DUR',
  'CLK',
  'UNIT',
  'APP',
  'CITY',
  'DAYW',
  'DOT',
  'DOMAIN',
  'HHMM',
]);

function glossOf(token: Tok, previous: string | undefined): string {
  if (token.kind === 'lat' && ENGLISH_PASS.has(token.text.toLowerCase())) {
    return token.text.toLowerCase();
  }
  switch (token.sym) {
    case 'NUM':
    case 'UNIT':
    case 'APP':
    case 'CITY':
    case 'DAYW':
    case 'DUR':
      return token.payload ?? token.text;
    case 'DOT':
    case 'DOMAIN':
      return token.payload ?? token.text;
    case 'HHMM': {
      const [hour = 0, minute = 0] = (token.payload ?? '').split(':').map(Number);
      return englishTime(hour, minute);
    }
    case 'CLK': {
      const time = token.time ?? '';
      const bare = previous === 'for' || previous === 'at' || previous === 'by';
      const at = token.day === undefined && bare ? '' : 'at ';
      return `${token.day === undefined ? '' : `${token.day} `}${at}${time}`;
    }
    case 'W':
      return token.text;
    default:
      return GLOSS[token.sym] ?? '';
  }
}

/** The English-order reading of a mixed sentence, or null when it would not change anything. */
export function glossUtterance(u: Utterance): string | null {
  if (u.has('NO')) return null;
  const hasLatin = u.toks.some((token) => token.kind === 'lat');
  const hindiValue = u.toks.some(
    (token) =>
      token.kind !== 'lat' &&
      token.kind !== 'num' &&
      (VALUE_SYMS.has(token.sym) || (token.sym !== 'W' && GLOSS[token.sym] !== undefined)),
  );
  if (!hasLatin || !hindiValue) return null;

  const words: string[] = [];
  for (const token of u.toks) {
    const word = glossOf(token, words[words.length - 1]);
    if (word !== '') words.push(word);
  }
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

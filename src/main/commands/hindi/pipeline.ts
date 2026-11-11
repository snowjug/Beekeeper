/**
 * Turns an utterance into a list of concept tokens: words are looked up in the lexicon, number
 * words become numbers, "सात बजे" becomes a clock time and "5 मिनट" a duration. The command rules
 * (rules/*.ts) then work on these tokens instead of on the raw words.
 */
import { lookupLoanword, lookupPhrase, lookupWord } from './lexicon';
import { digitsInfo, lookupNumberWord, readNumber, type NumberToken } from './numbers';
import { cleanScript, tokenize, type RawKind, type RawToken } from './script';

export interface Tok extends NumberToken {
  /** Concept symbol (TIMER, OPEN, ...), a class (NUM, DUR, CLK, APP, CITY, UNIT ...) or W for a free word. */
  sym: string;
  /** The words as spoken (merged tokens join theirs). */
  text: string;
  kind: RawKind;
  /** English value: unit, app, city, weekday, duration ("1 hour 30 minutes"), number text. */
  payload?: string;
  value?: number;
  /** CLK: "today" / "tomorrow" when the time names a day. */
  day?: string;
  /** CLK: the English time of day, "7:30 am". */
  time?: string;
}

const SYMBOLS: Readonly<Record<string, string>> = {
  '+': 'PLUS',
  '-': 'MINUS',
  '*': 'TIMES',
  '\u00D7': 'TIMES',
  '/': 'DIV',
  '\u00F7': 'DIV',
  '^': 'POWER',
  '=': 'EQUALS',
  '%': 'PERCENT',
};

const MAX_PHRASE_WORDS = 4;

function lexOne(raw: RawToken): Tok {
  const base = { text: raw.orig, kind: raw.kind };
  if (raw.kind === 'url') return { ...base, sym: 'DOMAIN', payload: raw.orig };
  if (raw.kind === 'sym') return { ...base, sym: SYMBOLS[raw.text] ?? 'W' };
  if (raw.kind === 'num') {
    if (raw.text.includes(':')) return { ...base, sym: 'HHMM', payload: raw.text };
    const info = digitsInfo(raw.text);
    if (info === null) return { ...base, sym: 'W' };
    return { ...base, sym: 'NUM', value: info.value, num: info, payload: raw.text };
  }

  const script = raw.kind === 'dev' ? 'dev' : 'lat';
  const number = lookupNumberWord(raw.text, script);
  const concept = lookupWord(raw.text, script);
  if (number !== null) {
    const sym = number.ambiguous ? (concept?.sym ?? (number.value === 1 ? 'ONE' : 'W')) : 'NUMW';
    return { ...base, sym, value: number.value, num: number };
  }
  if (concept !== null) {
    return {
      ...base,
      sym: concept.sym,
      ...(concept.payload === undefined ? {} : { payload: concept.payload }),
    };
  }
  if (raw.kind === 'dev') {
    const loan = lookupLoanword([raw.text]);
    if (loan !== null) {
      return {
        ...base,
        sym: loan.sym,
        ...(loan.payload === undefined ? {} : { payload: loan.payload }),
      };
    }
  }
  return { ...base, sym: 'W' };
}

function isWord(raw: RawToken): boolean {
  return raw.kind === 'dev' || raw.kind === 'lat';
}

/** Words -> tokens. Phrases of up to four words that the vocabulary knows ("कौन सा", "चैट जीपीटी") are one token. */
export function lex(raw: readonly RawToken[]): Tok[] {
  const out: Tok[] = [];
  let index = 0;
  while (index < raw.length) {
    let merged = false;
    for (
      let size = Math.min(MAX_PHRASE_WORDS, raw.length - index);
      size >= 2 && !merged;
      size -= 1
    ) {
      const slice = raw.slice(index, index + size);
      if (!slice.every(isWord)) continue;
      const words = slice.map((token) => token.text);
      let concept = lookupPhrase(words);
      if (concept === null && slice.every((token) => token.kind === 'dev')) {
        concept = lookupLoanword(words);
      }
      if (concept === null) continue;
      out.push({
        sym: concept.sym,
        text: slice.map((token) => token.orig).join(' '),
        kind: slice[0]?.kind ?? 'dev',
        ...(concept.payload === undefined ? {} : { payload: concept.payload }),
      });
      index += size;
      merged = true;
    }
    if (merged) continue;
    const token = raw[index];
    if (token !== undefined) out.push(lexOne(token));
    index += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_FOLLOWERS: ReadonlySet<string> = new Set([
  'MIN',
  'HOUR',
  'SEC',
  'DAY',
  'DAYU',
  'WEEK',
  'BAJE',
  'PERCENT',
  'PLUS',
  'MINUS',
  'TIMES',
  'DIV',
  'POWER',
  'EQUALS',
  'UNIT',
]);
const NUMBER_PRECEDERS: ReadonlySet<string> = new Set([
  'PLUS',
  'MINUS',
  'TIMES',
  'DIV',
  'POWER',
  'EQUALS',
  'NUM',
]);

/** "एक" and "दो" are numbers only next to a unit, a clock word or an operator ("दो मिनट", "दो बजे"). */
function isNumberContext(
  beforePrevious: Tok | undefined,
  previous: Tok | undefined,
  next: Tok | undefined,
): boolean {
  if (next !== undefined && NUMBER_FOLLOWERS.has(next.sym)) return true;
  if (previous === undefined || !NUMBER_PRECEDERS.has(previous.sym)) return false;
  // "20 को 4 से भाग दो": an operator word after a postposition is a verb, so "दो" is "give".
  const verbal =
    previous.sym !== 'NUM' &&
    beforePrevious !== undefined &&
    ['FROM', 'IN', 'KO', 'KA'].includes(beforePrevious.sym);
  return !verbal;
}

function joinText(tokens: readonly Tok[]): string {
  return tokens.map((token) => token.text).join(' ');
}

function mergeNumbers(tokens: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === undefined) break;
    const read = token.num === undefined ? null : readNumber(tokens, index);
    if (read === null) {
      out.push(token);
      index += 1;
      continue;
    }
    const span = tokens.slice(index, read.end);
    const lone = span.length === 1 && token.num?.ambiguous === true;
    if (lone && !isNumberContext(out[out.length - 2], out[out.length - 1], tokens[read.end])) {
      out.push(token);
      index += 1;
      continue;
    }
    out.push({
      sym: 'NUM',
      text: joinText(span),
      kind: token.kind,
      value: read.value,
      payload: String(read.value),
      num: { kind: 'digits', value: read.value },
    });
    index = read.end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clock times: "सुबह सात बजे", "कल शाम साढ़े पाँच बजे", "7:30", "रात 12 बजे"
// ---------------------------------------------------------------------------

const PARTS_OF_DAY: ReadonlySet<string> = new Set(['MORNING', 'NOON', 'EVENING', 'NIGHT']);
const DAY_WORDS: Readonly<Record<string, string>> = { TODAY: 'today', TOMORROW: 'tomorrow' };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The reading of an hour without am/pm that the part of the day implies ("शाम 6" is 6 pm). */
function meridiemFor(part: string | undefined, hour: number): 'am' | 'pm' | null {
  if (part === undefined || hour < 1 || hour > 12) return null;
  switch (part) {
    case 'MORNING':
      return 'am';
    case 'NOON':
      return hour === 12 || hour <= 9 ? 'pm' : 'am';
    case 'EVENING':
      return 'pm';
    case 'NIGHT':
      return hour === 12 || hour <= 5 ? 'am' : 'pm';
    default:
      return null;
  }
}

/** English clock text for what the timeparse module understands: "7:30 am", "6 pm", "19:45", "noon". */
export function englishTime(
  hour: number,
  minute: number,
  part?: string,
  meridiem?: 'am' | 'pm',
): string {
  if (hour === 12 && minute === 0 && part === 'NOON') return 'noon';
  if (hour === 12 && minute === 0 && part === 'NIGHT') return 'midnight';
  const resolved = meridiem ?? meridiemFor(part, hour);
  const minutes = minute === 0 ? '' : `:${pad(minute)}`;
  if (resolved !== null && hour >= 1 && hour <= 12) return `${hour}${minutes} ${resolved}`;
  if (hour === 0 || hour >= 13) return `${hour}:${pad(minute)}`;
  return `${hour}${minutes}`;
}

interface ClockRead {
  token: Tok;
  end: number;
}

function hourMinute(value: number): { hour: number; minute: number } | null {
  const hour = Math.floor(value);
  const minute = Math.round((value - hour) * 60);
  return hour >= 0 && hour <= 24 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function meridiemOf(token: Tok | undefined): 'am' | 'pm' | undefined {
  return token?.payload === 'am' || token?.payload === 'pm' ? token.payload : undefined;
}

function readClock(tokens: readonly Tok[], start: number): ClockRead | null {
  let cursor = start;
  let day: string | undefined;
  let part: string | undefined;
  let meridiem: 'am' | 'pm' | undefined;

  const dayWord = DAY_WORDS[tokens[cursor]?.sym ?? ''];
  if (dayWord !== undefined) {
    day = dayWord;
    cursor += 1;
  }
  const partToken = tokens[cursor];
  if (partToken !== undefined && PARTS_OF_DAY.has(partToken.sym)) {
    part = partToken.sym;
    cursor += 1;
    if (tokens[cursor]?.sym === 'KO') cursor += 1;
  }

  const first = tokens[cursor];
  const second = tokens[cursor + 1];
  let time: { hour: number; minute: number } | null = null;
  let midnight = false;
  if (first?.sym === 'HHMM') {
    const [hour = 0, minute = 0] = (first.payload ?? '').split(':').map(Number);
    time = minute <= 59 && hour <= 24 ? { hour, minute } : null;
    cursor += 1;
    if (second?.sym === 'AMPM') {
      meridiem = meridiemOf(second);
      cursor += 1;
    } else if (second?.sym === 'BAJE') {
      cursor += 1;
    }
  } else if (first?.sym === 'NUM' && second?.sym === 'BAJE') {
    time = hourMinute(first.value ?? -1);
    cursor += 2;
    const minutes = tokens[cursor];
    if (time !== null && minutes?.sym === 'NUM' && tokens[cursor + 1]?.sym === 'MIN') {
      const minute = minutes.value ?? -1;
      if (Number.isInteger(minute) && minute >= 0 && minute <= 59) {
        time = { hour: time.hour, minute };
        cursor += 2;
      }
    }
  } else if (first?.sym === 'NUM' && second?.sym === 'AMPM') {
    time = hourMinute(first.value ?? -1);
    meridiem = meridiemOf(second);
    cursor += 2;
  } else if (
    part !== undefined &&
    first?.sym === 'NUM' &&
    !NUMBER_FOLLOWERS.has(second?.sym ?? '')
  ) {
    time = hourMinute(first.value ?? -1);
    cursor += 1;
  } else if (first?.sym === 'MIDNIGHT') {
    time = { hour: 0, minute: 0 };
    midnight = true;
    cursor += 1;
  }
  if (time === null) return null;

  if (part === undefined) {
    const trailing = tokens[cursor];
    if (trailing !== undefined && PARTS_OF_DAY.has(trailing.sym)) {
      part = trailing.sym;
      cursor += 1;
      if (tokens[cursor]?.sym === 'KO') cursor += 1;
    }
  }
  const token: Tok = {
    sym: 'CLK',
    text: joinText(tokens.slice(start, cursor)),
    kind: 'dev',
    time: midnight ? 'midnight' : englishTime(time.hour, time.minute, part, meridiem),
    ...(day === undefined ? {} : { day }),
  };
  return { token, end: cursor };
}

function mergeClocks(tokens: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === undefined) break;
    const read = readClock(tokens, index);
    if (read === null) {
      out.push(token);
      index += 1;
    } else {
      out.push(read.token);
      index = read.end;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Durations: "5 मिनट", "डेढ़ घंटा", "एक घंटा बीस मिनट"
// ---------------------------------------------------------------------------

const DURATION_UNITS: Readonly<Record<string, string>> = {
  SEC: 'second',
  MIN: 'minute',
  HOUR: 'hour',
  DAY: 'day',
  DAYU: 'day',
  WEEK: 'week',
};

function durationPart(tokens: readonly Tok[], index: number): { text: string; end: number } | null {
  const amount = tokens[index];
  const unit = DURATION_UNITS[tokens[index + 1]?.sym ?? ''];
  if (amount?.sym !== 'NUM' || unit === undefined || amount.value === undefined) return null;
  const plural = amount.value === 1 ? unit : `${unit}s`;
  return { text: `${amount.value} ${plural}`, end: index + 2 };
}

function mergeDurations(tokens: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === undefined) break;
    const first = durationPart(tokens, index);
    if (first === null) {
      out.push(token);
      index += 1;
      continue;
    }
    const parts = [first.text];
    let end = first.end;
    for (;;) {
      const afterAnd = tokens[end]?.sym === 'AND' ? end + 1 : end;
      const next = durationPart(tokens, afterAnd);
      if (next === null) break;
      parts.push(next.text);
      end = next.end;
    }
    out.push({
      sym: 'DUR',
      text: joinText(tokens.slice(index, end)),
      kind: token.kind,
      payload: parts.join(' '),
    });
    index = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small clean-ups
// ---------------------------------------------------------------------------

function tidy(tokens: readonly Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === undefined) continue;
    if (token.sym === 'YAAD' && next?.sym === 'DILA') {
      out.push({ sym: 'REMIND', text: `${token.text} ${next.text}`, kind: token.kind });
      index += 1;
    } else if (token.sym === 'KA' && next?.sym === 'FOR') {
      continue;
    } else {
      out.push(token);
    }
  }
  return out;
}

/** Words -> concept tokens with numbers, clock times and durations merged. */
export function tokensOf(text: string): Tok[] {
  const lexed = lex(tokenize(cleanScript(text)));
  return tidy(mergeDurations(mergeClocks(mergeNumbers(lexed))));
}

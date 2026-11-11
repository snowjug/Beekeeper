/**
 * Detects things worth acting on in OCR text (links, e-mail addresses, phone numbers, dates and
 * arithmetic) for the Circle to Search results sheet. Tuned for precision: OCR noise is common,
 * so ambiguous strings (version numbers, IP addresses, prices, ranges, page counters ...) are
 * ignored rather than guessed. Only http(s) links are ever produced.
 */
import { parseSafeExternalUrl } from './url';
import { isValidEmailAddress } from './webLinks';

export type SmartActionType = 'url' | 'email' | 'phone' | 'date' | 'math';

export interface SmartAction {
  /** Stable id (`<type>:<value>`), unique within one result. */
  id: string;
  type: SmartActionType;
  /** Button text: Open, Compose, Copy, Add reminder, Calculate. */
  label: string;
  /**
   * url: normalised http(s) URL (a scheme-less `www.example.com` gets `https://`).
   * email: the bare, lower-cased address (build the link with `buildMailtoUrl`).
   * phone: digits, a leading `+` is kept.
   * date: ISO 8601 date (`YYYY-MM-DD`) or local date-time (`YYYY-MM-DDTHH:mm`, with seconds and zone only when the text had them).
   * math: the expression, operators normalised to `+ - * / ^`.
   */
  value: string;
  /** The text as found on screen (OCR noise such as `|` for `l` repaired in links and addresses). */
  display: string;
  /** Same as `value`, set for dates only. */
  isoDate?: string;
}

export interface DetectSmartActionsOptions {
  /** Reference time for relative dates ("tomorrow") and year-less dates. Defaults to the current time. */
  now?: Date;
}

export const MAX_SMART_ACTIONS = 8;

const MAX_TEXT_LENGTH = 20_000;
const MAX_MATH_LENGTH = 120;

const LABELS: Record<SmartActionType, string> = {
  url: 'Open',
  email: 'Compose',
  phone: 'Copy',
  date: 'Add reminder',
  math: 'Calculate',
};

interface Found {
  type: SmartActionType;
  start: number;
  end: number;
  value: string;
  display: string;
  isoDate?: string;
}

type Claimed = Array<readonly [number, number]>;

function isFree(claimed: Claimed, start: number, end: number): boolean {
  return claimed.every(([from, to]) => end <= from || start >= to);
}

function claim(claimed: Claimed, start: number, end: number): void {
  claimed.push([start, end]);
}

// ---------------------------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const EXOTIC_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const INVISIBLE_CHARS = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;

function prepareText(text: string): string {
  return text
    .slice(0, MAX_TEXT_LENGTH)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, ' ')
    .replace(EXOTIC_SPACES, ' ')
    .replace(INVISIBLE_CHARS, '');
}

const URL_TOKEN_START = /^[([<\u2018\u201c"']?(?:https?:\/\/|www\.)/i;
const URL_START = /^(?:https?:\/\/|www\.)/i;
const URL_BREAK_END = /[/\-_=&?#%~+]$/;
const URL_CONTINUATION_START = /^[/?&=#%]/;
const URL_TAIL_TOKEN = /^[A-Za-z0-9._~:/?#@!$&'()*+,;=%|-]+/;
const URL_STRUCTURE_CHARS = /[-_/?=&#%.\d]/;
const LIST_MARKER = /^(?:[-*+\u2022\u2013]|\d{1,3}[.)])$/;

/** True when `next` looks like the rest of a link that was wrapped at the end of `line`. */
function continuesUrl(line: string, next: string): boolean {
  const token = /\S+$/.exec(line)?.[0];
  if (!token || !URL_TOKEN_START.test(token)) return false;
  const tail = URL_TAIL_TOKEN.exec(next)?.[0];
  if (!tail || URL_START.test(tail) || LIST_MARKER.test(tail)) return false;
  if (URL_CONTINUATION_START.test(tail)) return true;
  return URL_BREAK_END.test(token) && URL_STRUCTURE_CHARS.test(tail);
}

/** Joins links that were wrapped over several lines so they are detected as one. */
function rejoinWrappedUrls(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let index = 0;
  while (index < lines.length) {
    let line = lines[index] ?? '';
    index += 1;
    while (index < lines.length) {
      const trimmed = line.trimEnd();
      const next = (lines[index] ?? '').trimStart();
      if (!continuesUrl(trimmed, next)) break;
      line = trimmed + next;
      index += 1;
    }
    result.push(line);
  }
  return result.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

const GENERIC_TLDS =
  'com|org|net|edu|gov|mil|info|biz|io|ai|app|dev|co|xyz|online|site|tech|store|shop|blog|news|cloud|eu|tv|cc|ly';
// Country codes that are not everyday words or file extensions (so "main.py" or "do.it" stay text).
const COUNTRY_TLDS =
  'uk|de|fr|es|nl|se|fi|dk|ch|ie|nz|jp|kr|cn|ru|br|mx|za|au|ca|cz|ro|hu|gr|pt|tr|il|sg|hk|tw|vn|th|ph|ua';
const BARE_TLDS = `${GENERIC_TLDS}|${COUNTRY_TLDS}`;

const SCHEME_OR_WWW_URL = /(?<![\w@])(?:https?:\/\/|www\.)[^\s<>"`\u201c\u201d]+/gi;
const BARE_DOMAIN_URL = new RegExp(
  String.raw`(?<![\w@./:%-])(?!\|)(?:[a-z0-9|](?:[a-z0-9|-]{0,61}[a-z0-9|])?\.)+(?:${BARE_TLDS})(?![\w@-]|\.\w)(?::\d{2,5})?(?:[/?#][^\s<>"\`\u201c\u201d]*)?`,
  'gi',
);

const URL_TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  "'",
  '"',
  '*',
  '_',
  '`',
  '\u2019',
  '\u201d',
  '>',
]);
const URL_CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countOf(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Removes sentence punctuation and unbalanced closing brackets that follow a link in prose. */
function trimUrlTail(candidate: string): string {
  let end = candidate.length;
  while (end > 0) {
    const char = candidate.charAt(end - 1);
    const opener = URL_CLOSERS[char];
    if (URL_TRAILING_PUNCTUATION.has(char)) {
      end -= 1;
    } else if (opener && countOf(candidate.slice(0, end), char) > countOf(candidate, opener)) {
      end -= 1;
    } else {
      break;
    }
  }
  return candidate.slice(0, end);
}

const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;
const HOST_TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isPlausibleHost(url: URL, hasScheme: boolean): boolean {
  const hostname = url.hostname;
  if (hostname.startsWith('[') || IPV4_HOST.test(hostname)) return hasScheme;
  const labels = hostname.split('.');
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  if (labels.length === 1) {
    // Intranet names ("http://go/docs") need a port or path, a bare "https://exa" is just truncated text.
    const hasTarget = url.port !== '' || url.pathname.length > 1;
    return hasScheme && /[a-z]/.test(hostname) && (hostname === 'localhost' || hasTarget);
  }
  return HOST_TLD.test(labels[labels.length - 1] ?? '');
}

function isConsistentCase(host: string): boolean {
  return host === host.toLowerCase() || host === host.toUpperCase();
}

function urlFound(display: string, start: number, hasScheme: boolean): Found | null {
  if (display.length === 0) return null;
  const parsed = parseSafeExternalUrl(hasScheme ? display : `https://${display}`);
  if (!parsed || !isPlausibleHost(parsed, hasScheme)) return null;
  return { type: 'url', start, end: start + display.length, value: parsed.href, display };
}

function findUrls(line: string, claimed: Claimed): Found[] {
  const found: Found[] = [];
  const consider = (raw: string, start: number, hasScheme: boolean): void => {
    const display = trimUrlTail(raw).replace(/\|/g, 'l');
    const end = start + display.length;
    if (display.length === 0 || !isFree(claimed, start, end)) return;
    // Rejected candidates stay claimed so their parts (user:pass@host) are not picked up as e-mail addresses.
    claim(claimed, start, end);
    const result = urlFound(display, start, hasScheme);
    if (result) found.push(result);
  };
  for (const match of line.matchAll(SCHEME_OR_WWW_URL)) {
    consider(match[0], match.index, !/^www\./i.test(match[0]));
  }
  for (const match of line.matchAll(BARE_DOMAIN_URL)) {
    const host = /^[^/?#:]+/.exec(match[0])?.[0] ?? '';
    if (isConsistentCase(host)) consider(match[0], match.index, false);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// E-mail addresses
// ---------------------------------------------------------------------------------------------

const EMAIL_ADDRESS =
  /(?<![\w.%+|-])[A-Za-z0-9._%+|-]{1,64}@(?:[A-Za-z0-9|-]+\.)+[A-Za-z|]{2,24}(?![\w@|-]|\.\w)/g;

function findEmails(line: string, claimed: Claimed): Found[] {
  const found: Found[] = [];
  for (const match of line.matchAll(EMAIL_ADDRESS)) {
    const display = match[0].replace(/\|/g, 'l');
    if (!isValidEmailAddress(display)) continue;
    const start = match.index;
    const end = start + display.length;
    if (!isFree(claimed, start, end)) continue;
    claim(claimed, start, end);
    found.push({ type: 'email', start, end, value: display.toLowerCase(), display });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const H = String.raw`[^\S\n]`;
const MONTH_NAME = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAY_PREFIX = String.raw`(?:(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?,?${H}+)?`;
const FULL_WEEKDAY = String.raw`(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)`;
const CLOCK = String.raw`(?:(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:${H}*[ap]\.?m\.?)?|(?:1[0-2]|0?[1-9])${H}*[ap]\.?m\.?)`;
// Optional time of day right after a date: "at 3pm", ", 15:30", "- 9:00 AM".
const TIME_TAIL = String.raw`(${H}*(?:,|@|[-\u2013]|\bat\b|\bfrom\b)?${H}*(${CLOCK})(?![\w:]))?`;
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const ISO_DATE = new RegExp(
  String.raw`(?<![\w.\/-])(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?![\d/])(?:(?:T|${H}+|,${H}*)((?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\.\d+)?(?:${H}*[ap]\.?m\.?)?)(Z|[+-]\d{2}:?\d{2})?(?![\w:]))?`,
  'gi',
);
const NUMERIC_DATE = new RegExp(
  String.raw`(?<![\w.\/-])(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?![\d/]|[.-]\d)${TIME_TAIL}`,
  'gi',
);
const MONTH_FIRST_DATE = new RegExp(
  String.raw`(?<![\w-])${WEEKDAY_PREFIX}(${MONTH_NAME})\.?${H}*(\d{1,2})(?:st|nd|rd|th)?(?:${H}*[-\u2013]${H}*\d{1,2}(?:st|nd|rd|th)?)?(?:,?${H}*(\d{4}))?(?!\w)${TIME_TAIL}`,
  'gi',
);
const DAY_FIRST_DATE = new RegExp(
  String.raw`(?<![\w./-])${WEEKDAY_PREFIX}(\d{1,2})(?:st|nd|rd|th)?(?:${H}+of)?(?:${H}|-)+(${MONTH_NAME})\b\.?(?:(?:,?${H}*|-)(\d{4}))?(?!\w)${TIME_TAIL}`,
  'gi',
);
const RELATIVE_DAY = new RegExp(
  String.raw`\b(day${H}+after${H}+tomorrow|tomorrow|tonight|today)(?![\w'\u2019])${TIME_TAIL}`,
  'gi',
);
const WEEKDAY_DATE = new RegExp(
  String.raw`\b(next|this|on)${H}+(${FULL_WEEKDAY})\b${TIME_TAIL}`,
  'gi',
);
const IN_DAYS_DATE = new RegExp(
  String.raw`\bin${H}+(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)${H}+(day|week)s?\b`,
  'gi',
);

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

interface Clock {
  hours: number;
  minutes: number;
  seconds?: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function isRealDate({ year, month, day }: DateParts): boolean {
  if (year < 1900 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parseClock(text: string): Clock | null {
  const match = /^(\d{1,2})(?::([0-5]\d))?(?::([0-5]\d))?(?:\.\d+)?\s*(?:([ap])\.?m\.?)?$/i.exec(
    text.trim(),
  );
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  const seconds = match[3] === undefined ? undefined : Number(match[3]);
  return { hours, minutes: match[2] === undefined ? 0 : Number(match[2]), seconds };
}

function formatIso(parts: DateParts, clock: Clock | null, zone = ''): string {
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  if (!clock) return date;
  const seconds = clock.seconds === undefined ? '' : `:${pad(clock.seconds)}`;
  return `${date}T${pad(clock.hours)}:${pad(clock.minutes)}${seconds}${zone}`;
}

function startOfToday(now: Date): DateParts {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(parts.year, parts.month - 1, parts.day + days);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function compareParts(a: DateParts, b: DateParts): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** The next occurrence (today included) of a month/day that has no year in the text. */
function inferYear(month: number, day: number, now: Date): DateParts | null {
  const today = startOfToday(now);
  for (let year = today.year; year <= today.year + 4; year += 1) {
    const candidate = { year, month, day };
    if (isRealDate(candidate) && compareParts(candidate, today) >= 0) return candidate;
  }
  return null;
}

function weekdayDate(modifier: string, weekday: number, now: Date): DateParts {
  const today = startOfToday(now);
  const todayIndex = now.getDay();
  let offset: number;
  if (modifier === 'this') {
    offset = (weekday - todayIndex + 7) % 7;
  } else if (modifier === 'on') {
    offset = (weekday - todayIndex + 7) % 7 || 7;
  } else {
    // "next Friday": the Friday of the following calendar week (weeks start on Monday)
    const untilNextMonday = (8 - todayIndex) % 7 || 7;
    offset = untilNextMonday + ((weekday + 6) % 7);
  }
  return addDays(today, offset);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Time of day captured by TIME_TAIL (the last two groups of a match), if it parses. */
function tailClock(match: RegExpExecArray): { clock: Clock | null; tailLength: number } {
  const tail = match[match.length - 2];
  const clock = tail === undefined ? null : parseClock(match[match.length - 1] ?? '');
  return { clock, tailLength: clock ? 0 : (tail?.length ?? 0) };
}

function findDates(line: string, claimed: Claimed, now: Date): Found[] {
  const found: Found[] = [];

  const add = (
    match: RegExpExecArray,
    parts: DateParts | null,
    clock: Clock | null,
    tailLength: number,
    zone = '',
  ): void => {
    if (!parts || !isRealDate(parts)) return;
    const start = match.index;
    const end = start + match[0].length - tailLength;
    if (!isFree(claimed, start, end)) return;
    const iso = formatIso(parts, clock, zone);
    claim(claimed, start, end);
    found.push({
      type: 'date',
      start,
      end,
      value: iso,
      display: collapse(line.slice(start, end)),
      isoDate: iso,
    });
  };

  for (const match of line.matchAll(ISO_DATE)) {
    const [, year, , month, day, time, zone] = match;
    const clock = time === undefined ? null : parseClock(time);
    add(
      match,
      { year: Number(year), month: Number(month), day: Number(day) },
      clock,
      time !== undefined && !clock ? time.length : 0,
      clock ? (zone ?? '') : '',
    );
  }

  for (const match of line.matchAll(NUMERIC_DATE)) {
    const [, first, separator, second, yearText] = match;
    if (yearText?.length === 2 && separator !== '/') continue;
    const a = Number(first);
    const b = Number(second);
    let month: number;
    let day: number;
    if (a > 12 && b <= 12) {
      [day, month] = [a, b];
    } else if (a <= 12) {
      [month, day] = [a, b];
    } else {
      continue;
    }
    const rawYear = Number(yearText);
    const year = yearText?.length === 2 ? rawYear + (rawYear >= 70 ? 1900 : 2000) : rawYear;
    const { clock, tailLength } = tailClock(match);
    add(match, { year, month, day }, clock, tailLength);
  }

  for (const match of line.matchAll(MONTH_FIRST_DATE)) {
    const [, monthText = '', dayText, yearText] = match;
    if (monthText === 'may') continue;
    const month = MONTH_INDEX[monthText.slice(0, 3).toLowerCase()] ?? 0;
    const day = Number(dayText);
    const { clock, tailLength } = tailClock(match);
    const parts = yearText ? { year: Number(yearText), month, day } : inferYear(month, day, now);
    add(match, parts, clock, tailLength);
  }

  for (const match of line.matchAll(DAY_FIRST_DATE)) {
    const [, dayText, monthText = '', yearText] = match;
    if (monthText === 'may') continue;
    const month = MONTH_INDEX[monthText.slice(0, 3).toLowerCase()] ?? 0;
    const day = Number(dayText);
    const { clock, tailLength } = tailClock(match);
    const parts = yearText ? { year: Number(yearText), month, day } : inferYear(month, day, now);
    add(match, parts, clock, tailLength);
  }

  for (const match of line.matchAll(RELATIVE_DAY)) {
    const word = collapse((match[1] ?? '').toLowerCase());
    const { clock, tailLength } = tailClock(match);
    const needsTime = word === 'today' || word === 'tonight';
    if (needsTime && !clock) continue;
    const offsets: Record<string, number> = { 'day after tomorrow': 2, tomorrow: 1 };
    add(match, addDays(startOfToday(now), offsets[word] ?? 0), clock, tailLength);
  }

  for (const match of line.matchAll(WEEKDAY_DATE)) {
    const modifier = (match[1] ?? '').toLowerCase();
    const weekday = WEEKDAY_INDEX[(match[2] ?? '').slice(0, 3).toLowerCase()] ?? 0;
    const { clock, tailLength } = tailClock(match);
    add(match, weekdayDate(modifier, weekday, now), clock, tailLength);
  }

  for (const match of line.matchAll(IN_DAYS_DATE)) {
    const amountText = (match[1] ?? '').toLowerCase();
    const amount = NUMBER_WORDS[amountText] ?? Number(amountText);
    const days = (match[2] ?? '').toLowerCase() === 'week' ? amount * 7 : amount;
    add(match, addDays(startOfToday(now), days), null, 0);
  }

  return found;
}

// ---------------------------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------------------------

const PHONE_SEPARATOR = String.raw`(?:${H}?[-.]${H}?|${H})`;
const PHONE_GROUP = String.raw`(?:\(\d{1,4}\)|\d{1,6})`;
const PHONE_NUMBER = new RegExp(
  String.raw`(?<![\w@/.+-])(\+${H}?)?(${PHONE_GROUP}(?:${PHONE_SEPARATOR}${PHONE_GROUP}){1,5}|\d{7,15})(?![\w@/]|[-.]\d)`,
  'g',
);
const PHONE_LABEL =
  /(?:tel|telephone|phone|ph|mobile|mob|cell|call|fax|whatsapp|dial|sms|contact)\.?[:#\s-]*$/i;

function phoneValue(body: string, plus: boolean, labeled: boolean): string | null {
  const groups = body.match(/\d+/g) ?? [];
  const lengths = groups.map((group) => group.length);
  const digits = groups.join('');
  if (digits.length < 7 || digits.length > 15) return null;
  if (plus) return digits.length >= 8 ? `+${digits}` : null;
  const [first = 0, second = 0, third = 0] = lengths;
  const looksLikeDate =
    lengths.length === 3 &&
    ((first === 4 && second <= 2 && third <= 2) || (third === 4 && first <= 2 && second <= 2));
  if (looksLikeDate) return null;
  const dotted =
    body.includes('.') && lengths.length >= 3 && lengths.every((length) => length <= 3);
  if (dotted && !labeled) return null;
  if (labeled) return digits;
  const northAmerican =
    (lengths.length === 3 && first === 3 && second === 3 && third === 4) ||
    (lengths.length === 4 && first === 1 && second === 3 && third === 3 && lengths[3] === 4);
  const national =
    digits.startsWith('0') && digits.length >= 9 && digits.length <= 12 && lengths.length <= 5;
  const indianMobile = lengths.length === 2 && first === 5 && second === 5 && /^[6-9]/.test(digits);
  return northAmerican || national || indianMobile ? digits : null;
}

function findPhones(line: string, claimed: Claimed): Found[] {
  const found: Found[] = [];
  for (const match of line.matchAll(PHONE_NUMBER)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isFree(claimed, start, end)) continue;
    const labeled = PHONE_LABEL.test(line.slice(Math.max(0, start - 20), start));
    const value = phoneValue(match[2] ?? '', match[1] !== undefined, labeled);
    if (!value) continue;
    claim(claimed, start, end);
    found.push({ type: 'phone', start, end, value, display: match[0].trim() });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

const NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const PERCENT_OF = new RegExp(
  String.raw`(?<![\w.,])(\d+(?:\.\d+)?)${H}*(?:%|percent)${H}+of${H}+[$\u20ac\u00a3]?(${NUMBER})(?![\w.]|,\d)`,
  'gi',
);
const MATH_RUN = /[\d\s.,+\-*/\u00d7\u00f7^%()\u2212\u2013]+/g;
const GLUE = /[A-Za-z_:\\#@]/;
const NUMBER_TOKEN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|^\.\d+/;
const MINUS_SIGNS = new Set(['-', '\u2212', '\u2013']);
const MULTIPLY_SIGNS = new Set(['*', '\u00d7']);

type MathToken =
  | { kind: 'number'; text: string }
  | { kind: 'operator'; text: string; spaced: boolean }
  | { kind: 'open' | 'close' | 'percent'; text: string };

function tokenizeMath(run: string): MathToken[] | null {
  const tokens: MathToken[] = [];
  let index = 0;
  while (index < run.length) {
    const char = run.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = NUMBER_TOKEN.exec(run.slice(index))?.[0];
    if (number !== undefined) {
      tokens.push({ kind: 'number', text: number });
      index += number.length;
      continue;
    }
    const before = index > 0 && /\s/.test(run.charAt(index - 1));
    const after = index + 1 < run.length && /\s/.test(run.charAt(index + 1));
    if (char === '(') {
      tokens.push({ kind: 'open', text: char });
    } else if (char === ')') {
      tokens.push({ kind: 'close', text: char });
    } else if (char === '%') {
      tokens.push({ kind: 'percent', text: char });
    } else if ('+-*/^\u00d7\u00f7\u2212\u2013'.includes(char)) {
      tokens.push({ kind: 'operator', text: char, spaced: before && after });
    } else {
      return null;
    }
    index += 1;
  }
  return tokens;
}

interface MathShape {
  operands: number;
  operators: number;
  valid: boolean;
}

/** Recursive-descent check of `tokens` against the usual arithmetic grammar; nothing is evaluated. */
function checkMathGrammar(tokens: readonly MathToken[]): MathShape {
  const shape: MathShape = { operands: 0, operators: 0, valid: true };
  let position = 0;
  const peek = (): MathToken | undefined => tokens[position];

  const binary = (allowed: (token: MathToken) => boolean): boolean => {
    const token = peek();
    if (!token || token.kind !== 'operator' || !allowed(token)) return false;
    const previous = tokens[position - 1];
    const next = tokens[position + 1];
    const touchesParen = previous?.kind === 'close' || next?.kind === 'open';
    const needsSpaces = MINUS_SIGNS.has(token.text) || token.text === '/';
    if (needsSpaces && !token.spaced && !touchesParen) {
      shape.valid = false;
      return false;
    }
    position += 1;
    shape.operators += 1;
    return true;
  };

  const atom = (depth: number): void => {
    const token = peek();
    if (token?.kind === 'number') {
      position += 1;
      shape.operands += 1;
    } else if (token?.kind === 'open' && depth < 4) {
      position += 1;
      expression(depth + 1);
      if (peek()?.kind === 'close') position += 1;
      else shape.valid = false;
    } else {
      shape.valid = false;
      return;
    }
    if (peek()?.kind === 'percent') position += 1;
  };

  const power = (depth: number): void => {
    atom(depth);
    if (shape.valid && binary((token) => token.text === '^')) factor(depth);
  };

  const factor = (depth: number): void => {
    const token = peek();
    if (token?.kind === 'operator' && (MINUS_SIGNS.has(token.text) || token.text === '+')) {
      const next = tokens[position + 1];
      if (next && (next.kind === 'number' || next.kind === 'open') && !token.spaced) {
        position += 1;
      } else {
        shape.valid = false;
        return;
      }
    }
    power(depth);
  };

  const term = (depth: number): void => {
    factor(depth);
    while (
      shape.valid &&
      binary(
        (token) => MULTIPLY_SIGNS.has(token.text) || token.text === '/' || token.text === '\u00f7',
      )
    ) {
      factor(depth);
    }
  };

  const expression = (depth: number): void => {
    term(depth);
    while (shape.valid && binary((token) => MINUS_SIGNS.has(token.text) || token.text === '+')) {
      term(depth);
    }
  };

  expression(0);
  if (position !== tokens.length) shape.valid = false;
  return shape;
}

function normalizeMath(text: string): string {
  return text
    .replace(/\u00d7/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimMathRun(line: string, from: number, to: number): [number, number] | null {
  let start = from;
  let end = to;
  const leading = /[\s.,+*/\u00d7\u00f7^%)-]/;
  while (start < end && leading.test(line.charAt(start))) {
    const char = line.charAt(start);
    const unary = (char === '-' || char === '+') && /[\d.(]/.test(line.charAt(start + 1));
    if (unary) break;
    start += 1;
  }
  while (end > start && /[\s.,+\-*/\u00d7\u00f7^(\u2212\u2013]/.test(line.charAt(end - 1)))
    end -= 1;
  return start < end ? [start, end] : null;
}

function isRangeOrCounter(tokens: readonly MathToken[]): boolean {
  const [left, operator, right] = tokens;
  if (tokens.length !== 3 || left?.kind !== 'number' || right?.kind !== 'number') return false;
  if (operator?.kind !== 'operator') return false;
  const ascending = Number(left.text.replace(/,/g, '')) < Number(right.text.replace(/,/g, ''));
  return ascending && (MINUS_SIGNS.has(operator.text) || operator.text === '/');
}

function findMath(line: string, claimed: Claimed): Found[] {
  const found: Found[] = [];

  for (const match of line.matchAll(PERCENT_OF)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isFree(claimed, start, end)) continue;
    claim(claimed, start, end);
    found.push({
      type: 'math',
      start,
      end,
      value: `${match[1]}% of ${normalizeMath(match[2] ?? '')}`,
      display: match[0],
    });
  }

  for (const run of line.matchAll(MATH_RUN)) {
    const bounds = trimMathRun(line, run.index, run.index + run[0].length);
    if (!bounds) continue;
    const [start, end] = bounds;
    // An expression glued to a letter, colon, ... is part of something else (A1+B2, 10:30-11:30, x^2+1).
    const gluedBefore = !/\s/.test(run[0].charAt(0)) && GLUE.test(line.charAt(run.index - 1));
    const gluedAfter =
      !/\s/.test(run[0].charAt(run[0].length - 1)) &&
      GLUE.test(line.charAt(run.index + run[0].length));
    if (gluedBefore || gluedAfter) continue;
    if (end - start > MAX_MATH_LENGTH || !isFree(claimed, start, end)) continue;
    const text = line.slice(start, end);
    const tokens = tokenizeMath(text);
    if (!tokens) continue;
    const shape = checkMathGrammar(tokens);
    if (!shape.valid || shape.operators === 0 || shape.operands < 2) continue;
    if (isRangeOrCounter(tokens)) continue;
    claim(claimed, start, end);
    found.push({ type: 'math', start, end, value: normalizeMath(text), display: collapse(text) });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

function detectInLine(line: string, now: Date): Found[] {
  const claimed: Claimed = [];
  return [
    ...findUrls(line, claimed),
    ...findEmails(line, claimed),
    ...findDates(line, claimed, now),
    ...findPhones(line, claimed),
    ...findMath(line, claimed),
  ].sort((a, b) => a.start - b.start);
}

/**
 * Finds links, e-mail addresses, phone numbers, dates and arithmetic in `text`, in reading order,
 * without duplicates and at most {@link MAX_SMART_ACTIONS} (8).
 */
export function detectSmartActions(
  text: string,
  options: DetectSmartActionsOptions = {},
): SmartAction[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const now = options.now ?? new Date();
  const actions: SmartAction[] = [];
  const seen = new Set<string>();
  for (const line of rejoinWrappedUrls(prepareText(text)).split('\n')) {
    if (line.trim().length === 0) continue;
    for (const item of detectInLine(line, now)) {
      const id = `${item.type}:${item.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const action: SmartAction = {
        id,
        type: item.type,
        label: LABELS[item.type],
        value: item.value,
        display: item.display,
      };
      if (item.isoDate !== undefined) action.isoDate = item.isoDate;
      actions.push(action);
      if (actions.length >= MAX_SMART_ACTIONS) return actions;
    }
  }
  return actions;
}

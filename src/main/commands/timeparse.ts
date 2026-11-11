import { findNumber, levenshtein } from './text';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MINUTES_PER_DAY = 24 * 60;
/** Readings before 06:00 are not guessed for hours written without am/pm. */
const SMALL_HOURS_END = 6 * 60;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface Piece {
  word: string;
  /** First and last source token the piece came from (glued tokens such as "5min" share one). */
  first: number;
  last: number;
}

function wordAt(words: readonly string[], index: number): string {
  return words[index] ?? '';
}

function cleanWord(raw: string): string {
  const word = raw
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^[\s,;:!?"'()]+|[\s,;:!?"'()]+$/g, '')
    .replace(/\.+$/, '');
  if (/^[ap]\.m$/.test(word)) return word.startsWith('a') ? 'am' : 'pm';
  return word === "o'clock" ? 'oclock' : word;
}

/** "5min" -> ["5", "min"], "1h30m" -> ["1", "h", "30", "m"], "7:30pm" -> ["7:30", "pm"]. */
function splitGlued(word: string): string[] {
  if (!/^\d/.test(word) || !/[a-z]/.test(word)) return [word];
  const parts = word.match(/\d+(?:[.:]\d+)?|[a-z]+/g);
  return parts !== null && parts.join('') === word ? parts : [word];
}

const HOUR_WORDS: ReadonlyMap<string, number> = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
]);

const CLOCK_LIKE = /^(?:\d{1,2}(?::\d{2})?|oclock)$/;

/** Words that can sit right before "a m" / "p m" in a spoken time ("three thirty p m"). */
function endsSpokenTime(word: string): boolean {
  if (CLOCK_LIKE.test(word)) return true;
  return NUMBER_WORDS.has(word) && word !== 'a' && word !== 'an' && word !== 'and';
}

/** Cleans tokens and splits glued number+unit tokens; "a m" / "o clock" are joined back. */
function toPieces(tokens: readonly string[]): Piece[] {
  const pieces: Piece[] = [];
  tokens.forEach((raw, index) => {
    const word = cleanWord(raw);
    if (word === '') return;
    for (const part of splitGlued(word)) {
      const previous = pieces[pieces.length - 1];
      const beforePrevious = pieces[pieces.length - 2];
      if (previous !== undefined && part === 'clock' && previous.word === 'o') {
        previous.word = 'oclock';
        previous.last = index;
      } else if (
        previous !== undefined &&
        part === 'm' &&
        (previous.word === 'a' || previous.word === 'p') &&
        beforePrevious !== undefined &&
        endsSpokenTime(beforePrevious.word)
      ) {
        previous.word = `${previous.word}m`;
        previous.last = index;
      } else {
        pieces.push({ word: part, first: index, last: index });
      }
    }
  });
  return pieces;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_WORDS: ReadonlySet<string> = new Set([
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'and',
  'a',
  'an',
]);

function isNumberish(word: string): boolean {
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(word) || NUMBER_WORDS.has(word);
}

/** Number (digits or words) that starts exactly at `index`. */
function numberAt(words: readonly string[], index: number): { value: number; end: number } | null {
  let limit = index;
  while (limit < words.length && isNumberish(wordAt(words, limit))) limit += 1;
  if (limit === index) return null;
  const hit = findNumber(words.slice(index, limit), 0);
  if (hit === null || hit.start !== 0 || !Number.isFinite(hit.value)) return null;
  return { value: hit.value, end: index + hit.end };
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

const UNIT_MS: ReadonlyMap<string, number> = new Map([
  ['s', SECOND],
  ['sec', SECOND],
  ['secs', SECOND],
  ['second', SECOND],
  ['seconds', SECOND],
  ['m', MINUTE],
  ['min', MINUTE],
  ['mins', MINUTE],
  ['minute', MINUTE],
  ['minutes', MINUTE],
  ['h', HOUR],
  ['hr', HOUR],
  ['hrs', HOUR],
  ['hour', HOUR],
  ['hours', HOUR],
  ['day', DAY],
  ['days', DAY],
  ['week', 7 * DAY],
  ['weeks', 7 * DAY],
]);

const FUZZY_UNITS: ReadonlyArray<readonly [string, number]> = [
  ['minutes', MINUTE],
  ['minute', MINUTE],
  ['seconds', SECOND],
  ['second', SECOND],
  ['hours', HOUR],
];

const FRACTIONS: ReadonlyMap<string, number> = new Map([
  ['half', 0.5],
  ['quarter', 0.25],
]);

function unitMs(word: string): number | null {
  const exact = UNIT_MS.get(word);
  if (exact !== undefined) return exact;
  if (word.length < 5) return null;
  for (const [name, ms] of FUZZY_UNITS) {
    if (word.startsWith(name.charAt(0)) && levenshtein(word, name, 1) <= 1) return ms;
  }
  return null;
}

/** "and a half" / "and a quarter" after a quantity or a unit. */
function fractionAfter(
  words: readonly string[],
  index: number,
): { fraction: number; end: number } | null {
  if (wordAt(words, index) !== 'and') return null;
  const next = wordAt(words, index + 1) === 'a' ? index + 2 : index + 1;
  const fraction = FRACTIONS.get(wordAt(words, next));
  return fraction === undefined ? null : { fraction, end: next + 1 };
}

interface DurationPart {
  ms: number;
  end: number;
  unit: number;
}

function isArticle(word: string): boolean {
  return word === 'a' || word === 'an';
}

/** One "<quantity> <unit>" group such as "5 minutes", "an hour", "half an hour", "2 and a half hours". */
function scanPart(words: readonly string[], index: number): DurationPart | null {
  let cursor = index;
  if (isArticle(wordAt(words, cursor)) && FRACTIONS.has(wordAt(words, cursor + 1))) cursor += 1;

  const fraction = FRACTIONS.get(wordAt(words, cursor));
  if (fraction !== undefined) {
    cursor += 1;
    if (wordAt(words, cursor) === 'of') cursor += 1;
    if (isArticle(wordAt(words, cursor))) cursor += 1;
    const unit = unitMs(wordAt(words, cursor));
    return unit === null ? null : { ms: fraction * unit, end: cursor + 1, unit };
  }

  let value: number;
  if (isArticle(wordAt(words, cursor)) && unitMs(wordAt(words, cursor + 1)) !== null) {
    value = 1;
    cursor += 1;
  } else {
    const quantity = numberAt(words, cursor);
    if (quantity === null) return null;
    value = quantity.value;
    cursor = quantity.end;
  }

  const lead = fractionAfter(words, cursor);
  if (lead !== null) {
    value += lead.fraction;
    cursor = lead.end;
  }
  const unit = unitMs(wordAt(words, cursor));
  if (unit === null) return null;
  cursor += 1;

  let ms = value * unit;
  if (lead === null) {
    const tail = fractionAfter(words, cursor);
    if (tail !== null) {
      ms += tail.fraction * unit;
      cursor = tail.end;
    }
  }
  return { ms, end: cursor, unit };
}

/** Sums consecutive parts ("1 hour 30 minutes"); a trailing bare number reads as the next smaller unit. */
function scanDuration(words: readonly string[], index: number): { ms: number; end: number } | null {
  const first = scanPart(words, index);
  if (first === null) return null;
  let { ms, end, unit } = first;

  for (;;) {
    const next = wordAt(words, end) === 'and' ? end + 1 : end;
    const part = scanPart(words, next);
    if (part !== null) {
      ms += part.ms;
      end = part.end;
      unit = part.unit;
      continue;
    }
    const smaller = unit === HOUR ? MINUTE : unit === MINUTE ? SECOND : null;
    const bare = smaller === null ? null : numberAt(words, next);
    if (
      smaller === null ||
      bare === null ||
      !Number.isInteger(bare.value) ||
      bare.value < 1 ||
      bare.value > 59 ||
      unitMs(wordAt(words, bare.end)) !== null
    ) {
      return { ms, end };
    }
    ms += bare.value * smaller;
    end = bare.end;
    unit = smaller;
  }
}

export interface DurationMatch {
  /** Length in milliseconds. */
  ms: number;
  /** Index of the first token of the duration. */
  start: number;
  /** Index after the last token of the duration. */
  end: number;
}

/**
 * Finds the first duration ("5 minutes", "half an hour", "1h30m") at or after token index
 * `from`, so callers can cut it out of a longer sentence.
 */
export function findDuration(tokens: readonly string[], from = 0): DurationMatch | null {
  const pieces = toPieces(tokens);
  const words = pieces.map((piece) => piece.word);
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if (piece === undefined || piece.first < from) continue;
    const hit = scanDuration(words, index);
    const lastPiece = hit === null ? undefined : pieces[hit.end - 1];
    if (hit !== null && lastPiece !== undefined) {
      return { ms: hit.ms, start: piece.first, end: lastPiece.last + 1 };
    }
  }
  return null;
}

const DURATION_LEAD_WORDS: ReadonlySet<string> = new Set([
  'for',
  'in',
  'after',
  'about',
  'around',
  'within',
]);

/**
 * Parses a whole text that is a duration: "5 minutes", "an hour and a half", "1.5 hours",
 * "two and a half minutes", "90 secs", "1h30m". Returns milliseconds, or null.
 */
export function parseDuration(text: string): number | null {
  const words = toPieces(text.trim().split(/\s+/)).map((piece) => piece.word);
  let start = 0;
  while (DURATION_LEAD_WORDS.has(wordAt(words, start))) start += 1;
  const hit = scanDuration(words, start);
  if (hit === null) return null;
  let end = hit.end;
  if (wordAt(words, end) === 'from' && wordAt(words, end + 1) === 'now') end += 2;
  else if (wordAt(words, end) === 'later') end += 1;
  return end === words.length ? hit.ms : null;
}

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

type Meridiem = 'am' | 'pm';
type DayWord = 'today' | 'tomorrow' | 'tonight';
type PartOfDay = 'am' | 'pm' | 'night';

export interface ClockTimeOptions {
  /**
   * How an hour written without am/pm ("at 8") is read. "next" (default) picks the soonest
   * daytime occurrence, "morning" always means AM - handy for alarms.
   */
  ambiguousHours?: 'next' | 'morning';
}

export interface ClockTime {
  /** The next occurrence of the time. Only in the past when the user said "today". */
  at: Date;
  /** True when "today", "tomorrow" or "tonight" was part of the expression. */
  hasDayWord: boolean;
}

export interface ClockTimeMatch extends ClockTime {
  /** Indices of the tokens that make up the time expression (including "at" and day words). */
  consumed: number[];
}

interface TimeSpec {
  /** Minutes after midnight for each reading of the time. */
  readings: number[];
  /** True for a 12-hour time without am/pm; readings are then [AM, PM]. */
  ambiguous: boolean;
  hour12: number;
}

interface ClockCore {
  spec: TimeSpec;
  end: number;
  /** A lone number such as "at 8"; only trusted after a preposition. */
  bare: boolean;
}

function wrapMinutes(value: number): number {
  return ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function fixed(minutes: number): TimeSpec {
  return { readings: [wrapMinutes(minutes)], ambiguous: false, hour12: 0 };
}

function twelveHour(hour12: number, minutes: number, meridiem: Meridiem | null): TimeSpec {
  const base = (hour12 % 12) * 60 + minutes;
  if (meridiem === 'am') return fixed(base);
  if (meridiem === 'pm') return fixed(base + 720);
  return { readings: [wrapMinutes(base), wrapMinutes(base + 720)], ambiguous: true, hour12 };
}

function core(spec: TimeSpec, end: number, bare = false): ClockCore {
  return { spec, end, bare };
}

function meridiemAt(words: readonly string[], index: number): Meridiem | null {
  const word = wordAt(words, index);
  return word === 'am' || word === 'pm' ? word : null;
}

function isValidHour12(hour: number): boolean {
  return hour >= 1 && hour <= 12;
}

interface HourToken {
  hour: number;
  spoken: boolean;
}

function hourToken(word: string): HourToken | null {
  const spoken = HOUR_WORDS.get(word);
  if (spoken !== undefined) return { hour: spoken, spoken: true };
  return /^\d{1,2}$/.test(word) ? { hour: Number(word), spoken: false } : null;
}

/** Minutes spoken after an hour: "thirty", "forty five", "oh five", or two digits ("30"). */
function minutesAt(
  words: readonly string[],
  index: number,
): { minutes: number; end: number; spoken: boolean } | null {
  if (wordAt(words, index) === 'oh') {
    const digit = HOUR_WORDS.get(wordAt(words, index + 1));
    return digit !== undefined && digit <= 9
      ? { minutes: digit, end: index + 2, spoken: true }
      : null;
  }
  const hit = numberAt(words, index);
  if (hit === null || !Number.isInteger(hit.value) || hit.value < 10 || hit.value > 59) return null;
  return { minutes: hit.value, end: hit.end, spoken: !/^\d+$/.test(wordAt(words, index)) };
}

function scanSpecial(words: readonly string[], index: number): ClockCore | null {
  const word = wordAt(words, index);
  if (word === 'noon' || word === 'midday') return core(fixed(720), index + 1);
  if (word === 'midnight') return core(fixed(0), index + 1);
  if (word === '12' || word === 'twelve') {
    const next = wordAt(words, index + 1);
    if (next === 'noon' || next === 'midday') return core(fixed(720), index + 2);
    if (next === 'midnight') return core(fixed(0), index + 2);
  }
  return null;
}

const PAST_WORDS: ReadonlySet<string> = new Set(['past', 'after']);
const TO_WORDS: ReadonlySet<string> = new Set(['to', 'before', 'till', 'of']);
const MINUTE_WORDS: ReadonlySet<string> = new Set(['minute', 'minutes', 'min', 'mins']);

/** "half past 7", "quarter to nine", "ten past three", "twenty to 8 pm". */
function scanRelative(words: readonly string[], index: number): ClockCore | null {
  let cursor = index;
  let offset: number;
  if (wordAt(words, cursor) === 'half') {
    offset = 30;
    cursor += 1;
  } else {
    if (isArticle(wordAt(words, cursor)) && wordAt(words, cursor + 1) === 'quarter') cursor += 1;
    if (wordAt(words, cursor) === 'quarter') {
      offset = 15;
      cursor += 1;
    } else {
      const minutes = numberAt(words, cursor);
      if (
        minutes === null ||
        !Number.isInteger(minutes.value) ||
        minutes.value < 5 ||
        minutes.value > 55 ||
        minutes.value % 5 !== 0
      ) {
        return null;
      }
      offset = minutes.value;
      cursor = minutes.end;
      if (MINUTE_WORDS.has(wordAt(words, cursor))) cursor += 1;
    }
  }

  const direction = wordAt(words, cursor);
  let sign: 1 | -1;
  if (PAST_WORDS.has(direction)) sign = 1;
  else if (offset !== 30 && TO_WORDS.has(direction)) sign = -1;
  else return null;
  cursor += 1;

  const target = wordAt(words, cursor);
  if (target === 'noon' || target === 'midnight') {
    return core(fixed((target === 'noon' ? 720 : 0) + sign * offset), cursor + 1);
  }
  const token = hourToken(target);
  if (token === null || !isValidHour12(token.hour)) return null;
  const meridiem = meridiemAt(words, cursor + 1);
  return core(
    twelveHour(token.hour, sign * offset, meridiem),
    cursor + (meridiem === null ? 1 : 2),
  );
}

function scanNumeric(words: readonly string[], index: number): ClockCore | null {
  const word = wordAt(words, index);

  const colon = /^(\d{1,2}):(\d{2})$/.exec(word);
  if (colon !== null) {
    const written = colon[1] ?? '';
    const hour = Number(written);
    const minute = Number(colon[2]);
    if (minute > 59 || hour > 23) return null;
    const meridiem = meridiemAt(words, index + 1);
    if (meridiem !== null) {
      return isValidHour12(hour) ? core(twelveHour(hour, minute, meridiem), index + 2) : null;
    }
    const twentyFour = hour === 0 || hour >= 12 || written.startsWith('0');
    return core(twentyFour ? fixed(hour * 60 + minute) : twelveHour(hour, minute, null), index + 1);
  }

  const dotted = /^(\d{1,2})\.(\d{2})$/.exec(word);
  if (dotted !== null) {
    const hour = Number(dotted[1]);
    const minute = Number(dotted[2]);
    const meridiem = meridiemAt(words, index + 1);
    if (meridiem === null || minute > 59 || !isValidHour12(hour)) return null;
    return core(twelveHour(hour, minute, meridiem), index + 2);
  }

  const token = hourToken(word);
  if (token === null) return null;
  const { hour, spoken } = token;
  const next = index + 1;
  if (unitMs(wordAt(words, next)) !== null) return null;

  const meridiem = meridiemAt(words, next);
  if (meridiem !== null) {
    return isValidHour12(hour) ? core(twelveHour(hour, 0, meridiem), next + 1) : null;
  }
  if (wordAt(words, next) === 'oclock') {
    if (!isValidHour12(hour)) return null;
    const after = meridiemAt(words, next + 1);
    return core(twelveHour(hour, 0, after), next + (after === null ? 1 : 2));
  }

  const minutes = isValidHour12(hour) ? minutesAt(words, next) : null;
  if (minutes !== null && unitMs(wordAt(words, minutes.end)) === null) {
    const after = meridiemAt(words, minutes.end);
    if (after !== null || spoken || minutes.spoken) {
      return core(twelveHour(hour, minutes.minutes, after), minutes.end + (after === null ? 0 : 1));
    }
  }

  if (isValidHour12(hour)) return core(twelveHour(hour, 0, null), next, true);
  if (!spoken && hour >= 13 && hour <= 23) return core(fixed(hour * 60), next, true);
  return null;
}

function scanClock(words: readonly string[], index: number): ClockCore | null {
  return scanSpecial(words, index) ?? scanRelative(words, index) ?? scanNumeric(words, index);
}

const CLOCK_PREPOSITIONS: ReadonlySet<string> = new Set([
  'at',
  'for',
  'by',
  'around',
  'about',
  'on',
]);
const BARE_PREPOSITIONS: ReadonlySet<string> = new Set(['at', 'by', 'around']);
const PART_INTRO_WORDS: ReadonlySet<string> = new Set(['in', 'at', 'this']);

const PARTS_OF_DAY: ReadonlyMap<string, PartOfDay> = new Map([
  ['morning', 'am'],
  ['afternoon', 'pm'],
  ['evening', 'pm'],
  ['night', 'night'],
]);

function dayWordOf(word: string): DayWord | null {
  if (word === 'today') return 'today';
  if (word === 'tomorrow' || word === 'tmrw' || word === '2morrow') return 'tomorrow';
  if (word === 'tonight' || word === 'tonite') return 'tonight';
  if (word.length >= 6 && word.startsWith('to')) {
    if (levenshtein(word, 'tomorrow', 2) <= 2) return 'tomorrow';
    if (levenshtein(word, 'tonight', 1) <= 1) return 'tonight';
  }
  return null;
}

/** True for "today", "tomorrow", "tonight" and their usual misspellings. */
export function isDayWord(word: string): boolean {
  return dayWordOf(word) !== null;
}

interface LocatedCore {
  start: number;
  core: ClockCore;
}

/** "in the morning", "this evening", "at night" starting at `index`. */
function partOfDayAt(
  words: readonly string[],
  index: number,
): { hint: PartOfDay; end: number; today: boolean } | null {
  let cursor = index;
  const intro = wordAt(words, cursor);
  if (PART_INTRO_WORDS.has(intro)) cursor += 1;
  if (wordAt(words, cursor) === 'the') cursor += 1;
  const hint = PARTS_OF_DAY.get(wordAt(words, cursor));
  return hint === undefined ? null : { hint, end: cursor + 1, today: intro === 'this' };
}

/**
 * First clock expression. A lone number only counts right after "at"/"by"/"around", before a
 * part of day ("8 tonight", "5 in the evening") or when it is the whole text.
 */
function locateCore(
  words: readonly string[],
  barePrepositions: ReadonlySet<string>,
  whole: boolean,
): LocatedCore | null {
  let bare: LocatedCore | null = null;
  for (let index = 0; index < words.length; index += 1) {
    const hit = scanClock(words, index);
    if (hit === null) continue;
    if (!hit.bare) return { start: index, core: hit };
    const previous = wordAt(words, index - 1);
    const trusted =
      barePrepositions.has(previous) ||
      (previous === 'for' && index === 1) ||
      (whole && words.length === 1) ||
      partOfDayAt(words, hit.end) !== null ||
      dayWordOf(wordAt(words, hit.end)) === 'tonight';
    if (trusted && bare === null) bare = { start: index, core: hit };
  }
  return bare;
}

function pickReadings(spec: TimeSpec, hint: PartOfDay | null, mode: 'next' | 'morning'): number[] {
  if (!spec.ambiguous) return spec.readings;
  const [am = 0, pm = 0] = spec.readings;
  if (hint === 'am') return [am];
  if (hint === 'pm') return [pm];
  if (hint === 'night') return [spec.hour12 >= 6 && spec.hour12 <= 11 ? pm : am];
  if (mode === 'morning') return [spec.hour12 === 12 ? pm : am];
  const daytime = spec.readings.filter((minutes) => minutes >= SMALL_HOURS_END);
  return daytime.length > 0 ? daytime : spec.readings;
}

function atMinutes(now: Date, dayOffset: number, minutes: number): Date {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0,
  );
}

function earliest(dates: readonly Date[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (best, date) => (best === undefined || date.getTime() < best.getTime() ? date : best),
    undefined,
  );
}

function latest(dates: readonly Date[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (best, date) => (best === undefined || date.getTime() > best.getTime() ? date : best),
    undefined,
  );
}

function resolveInstant(readings: readonly number[], day: DayWord | null, now: Date): Date {
  const stamp = now.getTime();
  const fallback = atMinutes(now, 1, readings[0] ?? 0);
  if (day === 'tomorrow') {
    return earliest(readings.map((minutes) => atMinutes(now, 1, minutes))) ?? fallback;
  }
  if (day === 'today' || day === 'tonight') {
    const dated = readings.map((minutes) =>
      atMinutes(now, day === 'tonight' && minutes < SMALL_HOURS_END ? 1 : 0, minutes),
    );
    const upcoming = dated.filter((date) => date.getTime() > stamp);
    return (upcoming.length > 0 ? earliest(upcoming) : latest(dated)) ?? fallback;
  }
  const upcoming = readings
    .flatMap((minutes) => [atMinutes(now, 0, minutes), atMinutes(now, 1, minutes)])
    .filter((date) => date.getTime() > stamp);
  return earliest(upcoming) ?? fallback;
}

interface LocatedClock {
  match: ClockTimeMatch;
  /** True when every word of the input belongs to the expression. */
  complete: boolean;
}

function locateClock(
  tokens: readonly string[],
  now: Date,
  options: ClockTimeOptions,
  whole: boolean,
): LocatedClock | null {
  const pieces = toPieces(tokens);
  const words = pieces.map((piece) => piece.word);
  const found = locateCore(words, whole ? CLOCK_PREPOSITIONS : BARE_PREPOSITIONS, whole);
  if (found === null) return null;

  let start = found.start;
  let end = found.core.end;
  let hint: PartOfDay | null = null;
  let day: DayWord | null = null;

  if (CLOCK_PREPOSITIONS.has(wordAt(words, start - 1))) start -= 1;

  const partBefore = PARTS_OF_DAY.get(wordAt(words, start - 1));
  if (partBefore !== undefined) {
    hint = partBefore;
    start -= 1;
    if (wordAt(words, start - 1) === 'this') {
      day = 'today';
      start -= 1;
    }
  }
  const dayBefore = dayWordOf(wordAt(words, start - 1));
  if (dayBefore !== null && day === null) {
    day = dayBefore;
    start -= 1;
    if (CLOCK_PREPOSITIONS.has(wordAt(words, start - 1))) start -= 1;
  }

  const partAfter = partOfDayAt(words, end);
  if (partAfter !== null) {
    hint ??= partAfter.hint;
    if (partAfter.today) day ??= 'today';
    end = partAfter.end;
  }
  const dayAfter = dayWordOf(wordAt(words, end));
  if (dayAfter !== null && day === null) {
    day = dayAfter;
    end += 1;
  }

  const consumedPieces = new Set<number>();
  for (let index = start; index < end; index += 1) consumedPieces.add(index);
  if (day === null) {
    for (const edge of [0, words.length - 1]) {
      const edgeDay = consumedPieces.has(edge) ? null : dayWordOf(wordAt(words, edge));
      if (edgeDay !== null) {
        day = edgeDay;
        consumedPieces.add(edge);
        break;
      }
    }
  }

  const readings = pickReadings(
    found.core.spec,
    hint ?? (day === 'tonight' ? 'night' : null),
    options.ambiguousHours ?? 'next',
  );
  const consumed = new Set<number>();
  for (const index of consumedPieces) {
    const piece = pieces[index];
    if (piece === undefined) continue;
    for (let token = piece.first; token <= piece.last; token += 1) consumed.add(token);
  }

  return {
    match: {
      at: resolveInstant(readings, day, now),
      hasDayWord: day !== null,
      consumed: [...consumed].sort((a, b) => a - b),
    },
    complete: consumedPieces.size === pieces.length,
  };
}

/**
 * Finds a clock time ("7am", "3:30 pm", "19:45", "noon", "half past 7", "quarter to nine",
 * "7 o'clock", "seven thirty") with an optional day word ("today", "tomorrow", "tonight")
 * inside a sentence. The result is the next occurrence after `now`; a time said with "today"
 * that already passed stays in the past so the caller can say so.
 */
export function findClockTime(
  tokens: readonly string[],
  now: Date,
  options: ClockTimeOptions = {},
): ClockTimeMatch | null {
  return locateClock(tokens, now, options, false)?.match ?? null;
}

/** Parses a whole text that is a clock time, e.g. "7:30 pm", "tomorrow at 8", "half past 7". */
export function parseClockTime(
  text: string,
  now: Date,
  options: ClockTimeOptions = {},
): ClockTime | null {
  const located = locateClock(text.trim().split(/\s+/), now, options, true);
  if (located === null || !located.complete) return null;
  return { at: located.match.at, hasDayWord: located.match.hasDayWord };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/** "5 minutes", "1 hour 30 minutes", "45 seconds". */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms / SECOND)) : 0;
  if (total === 0) return '0 seconds';
  const parts: Array<[number, string]> = [
    [Math.floor(total / 86_400), 'day'],
    [Math.floor((total % 86_400) / 3_600), 'hour'],
    [Math.floor((total % 3_600) / 60), 'minute'],
    [total % 60, 'second'],
  ];
  return parts
    .filter(([value]) => value > 0)
    .map(([value, unit]) => plural(value, unit))
    .join(' ');
}

/** Countdown text: "4:32" or "1:02:10". Rounds up so a running timer never shows 0:00 early. */
export function formatRemaining(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / SECOND)) : 0;
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

function formatTimeOfDay(date: Date): string {
  const hours = date.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / DAY);
}

/**
 * "3:30 PM" for today, "tomorrow at 9:00 AM", "Friday at 9:00 AM" within a week,
 * otherwise "Nov 25 at 9:00 AM" (with the year when it differs).
 */
export function formatClock(date: Date, now: Date): string {
  const time = formatTimeOfDay(date);
  const days = calendarDaysBetween(now, date);
  if (days === 0) return time;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()] ?? ''} at ${time}`;
  const year = date.getFullYear() === now.getFullYear() ? '' : `, ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}${year} at ${time}`;
}

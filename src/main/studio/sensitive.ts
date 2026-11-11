/**
 * Finds personal data in the words that OCR read from a screenshot, so Photo assist can offer to
 * blur it: e-mail addresses, phone numbers, card numbers (Luhn checked), Aadhaar-like ID numbers,
 * API keys / tokens and the values written after "password:", "otp", "cvv" and similar labels.
 * Pure text and geometry: no OCR, no Electron. It leans towards finding too much rather than too
 * little, because the user reviews every box before anything is blurred.
 */
import type { Rect, Size } from '@shared/geometry';
import type { SensitiveRegion } from '@shared/ipc/types';

export interface SensitiveWord {
  text: string;
  /** Image pixels. */
  bbox: Rect;
}

export interface SensitiveLine {
  words: readonly SensitiveWord[];
}

export interface DetectOptions {
  /** Image size: regions are kept inside it. */
  bounds?: Size;
  /** Pixels added around every region (glyphs are wider than the boxes OCR reports). Default 4. */
  padding?: number;
}

type Kind = SensitiveRegion['kind'];

interface Match {
  kind: Kind;
  label: string;
  /** Character range [start, end) of the joined line text. */
  start: number;
  end: number;
  /** Lower wins when two matches overlap. */
  priority: number;
}

interface WordSpan {
  word: SensitiveWord;
  start: number;
  end: number;
}

const PRIORITY: Record<Kind, number> = { card: 0, id: 1, email: 2, secret: 3, phone: 4 };

const MIN_CARD_DIGITS = 13;
const MAX_CARD_DIGITS = 19;
const DEFAULT_PADDING = 4;

/** True when the digit string passes the Luhn checksum that every payment card number satisfies. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function match(kind: Kind, label: string, start: number, end: number): Match {
  return { kind, label, start, end, priority: PRIORITY[kind] };
}

function* regexMatches(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  for (let found = global.exec(text); found; found = global.exec(text)) {
    if (found[0].length === 0) {
      global.lastIndex += 1;
      continue;
    }
    yield found;
  }
}

// ---- cards and ID numbers ---------------------------------------------------------------------

interface DigitRun {
  start: number;
  end: number;
  digits: string;
}

/** Digit runs joined by a single space or dash ("4111 1111 1111 1111", "3782-822463-10005"). */
function digitChains(text: string): DigitRun[][] {
  const chains: DigitRun[][] = [];
  let current: DigitRun[] = [];
  for (const run of regexMatches(/\d+/, text)) {
    const item = { start: run.index, end: run.index + run[0].length, digits: run[0] };
    const previous = current[current.length - 1];
    if (previous && /^[ -]$/.test(text.slice(previous.end, item.start))) {
      current.push(item);
      continue;
    }
    if (current.length > 0) chains.push(current);
    current = [item];
  }
  if (current.length > 0) chains.push(current);
  return chains;
}

function findCards(text: string): Match[] {
  const found: Match[] = [];
  for (const chain of digitChains(text)) {
    let from = 0;
    while (from < chain.length) {
      let best = -1;
      let digits = '';
      for (let to = from; to < chain.length; to += 1) {
        digits += chain[to]?.digits ?? '';
        if (digits.length > MAX_CARD_DIGITS) break;
        if (digits.length >= MIN_CARD_DIGITS && !/^(\d)\1+$/.test(digits) && passesLuhn(digits)) {
          best = to;
        }
      }
      const first = chain[from];
      const last = chain[best];
      if (best >= 0 && first && last) {
        found.push(match('card', 'Card number', first.start, last.end));
        from = best + 1;
      } else {
        from += 1;
      }
    }
  }
  return found;
}

function findIds(text: string): Match[] {
  const found: Match[] = [];
  for (const grouped of regexMatches(
    /(?<![\d-])(?<!\d[ -])[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\d|[ -]\d)/,
    text,
  )) {
    found.push(match('id', 'ID number', grouped.index, grouped.index + grouped[0].length));
  }
  for (const plain of regexMatches(/(?<!\d)[2-9]\d{11}(?!\d)/, text)) {
    const kind: Kind = /^91[6-9]/.test(plain[0]) ? 'phone' : 'id';
    found.push(
      match(kind, kind === 'phone' ? 'Phone number' : 'ID number', plain.index, plain.index + 12),
    );
  }
  return found;
}

// ---- e-mail and phone numbers -----------------------------------------------------------------

function findEmails(text: string): Match[] {
  const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/;
  return [...regexMatches(pattern, text)].map((found) =>
    match('email', 'Email address', found.index, found.index + found[0].length),
  );
}

const PHONE_PATTERNS: readonly RegExp[] = [
  // +<country code> followed by 7-13 more digits in any common grouping
  /(?<![\w+])\+\d[\d ().-]{7,18}\d(?!\w)/,
  // India: 10 digits starting 6-9, optional +91 / 0 prefix, optional 5-5 grouping
  /(?<![\w+])(?:\+?91[ -]?)?0?[6-9]\d{4}[ -]?\d{5}(?!\d)/,
  // North America: (415) 555-2671, 415-555-2671, 415.555.2671, 4155552671, +1 415 555 2671
  /(?<![\w+])(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)/,
];

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

function findPhones(text: string): Match[] {
  const found: Match[] = [];
  for (const pattern of PHONE_PATTERNS) {
    for (const candidate of regexMatches(pattern, text)) {
      const count = digitCount(candidate[0]);
      if (count < 8 || count > 15) continue;
      const end = candidate.index + candidate[0].replace(/[\s.-]+$/, '').length;
      found.push(match('phone', 'Phone number', candidate.index, end));
    }
  }
  return found;
}

// ---- secrets -----------------------------------------------------------------------------------

const KEY_PREFIXES: readonly RegExp[] = [
  /^(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9_-]{16,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^AIza[0-9A-Za-z_-]{30,}$/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/,
];

const MIN_TOKEN_LENGTH = 24;
const EDGE_PUNCTUATION = /^[("'[{<]+|[)"'\]}>,;:.]+$/g;

/** Snake or kebab-case constants and slugs are long and contain digits but are not secrets. */
function looksLikeIdentifier(token: string): boolean {
  const parts = token.split(/[-_]/);
  return (
    parts.length >= 3 && parts.every((part) => part.length <= 14 && /^[A-Za-z]+\d{0,2}$/.test(part))
  );
}

function isTokenLike(token: string): boolean {
  if (KEY_PREFIXES.some((pattern) => pattern.test(token))) return true;
  if (token.length < MIN_TOKEN_LENGTH || !/^[A-Za-z0-9+/_=-]+$/.test(token)) return false;
  if (!/\d/.test(token) || !/[A-Za-z]/.test(token)) return false;
  return !looksLikeIdentifier(token);
}

function findTokens(spans: readonly WordSpan[]): Match[] {
  const found: Match[] = [];
  for (const span of spans) {
    const text = span.word.text;
    const trimmed = text.replace(EDGE_PUNCTUATION, '');
    if (trimmed === '' || !isTokenLike(trimmed)) continue;
    const offset = text.indexOf(trimmed);
    found.push(
      match('secret', 'Token or key', span.start + offset, span.start + offset + trimmed.length),
    );
  }
  return found;
}

type LabelKind = 'delimited' | 'digits' | 'bare';

/** "Bearer <token>" needs no delimiter, but the value must be long enough to be a token. */
const MIN_BEARER_LENGTH = 12;

const SECRET_LABELS: ReadonlyMap<string, LabelKind> = new Map([
  ['password', 'delimited'],
  ['passwd', 'delimited'],
  ['passcode', 'delimited'],
  ['secret', 'delimited'],
  ['token', 'delimited'],
  ['apikey', 'delimited'],
  ['api_key', 'delimited'],
  ['api-key', 'delimited'],
  ['pwd', 'delimited'],
  ['bearer', 'bare'],
  ['pin', 'digits'],
  ['otp', 'digits'],
  ['cvv', 'digits'],
  ['cvv2', 'digits'],
  ['cvc', 'digits'],
]);

const DELIMITER_WORD = /^(?:is|[:=-]+|is:)$/i;
const LABEL_WITH_VALUE = /^([A-Za-z_-]+?)([:=]+)(.+)$/;
const LABEL_WITH_DELIMITER = /^([A-Za-z_-]+?)([:=]+)$/;

function secretMatch(start: number, end: number): Match {
  return match('secret', 'Password or secret', start, end);
}

/** Values that follow "password:", "pwd=...", "OTP 482913", "CVV: 123" and similar labels. */
function findLabelledSecrets(spans: readonly WordSpan[]): Match[] {
  const found: Match[] = [];
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (!span) continue;
    const text = span.word.text;

    // "password:hunter2" or "pwd=abc": the value is inside the same word.
    const inline = LABEL_WITH_VALUE.exec(text);
    if (inline && SECRET_LABELS.has((inline[1] ?? '').toLowerCase())) {
      const rest = inline[3] ?? '';
      const value = rest.replace(EDGE_PUNCTUATION, '');
      if (value !== '') {
        const start =
          span.start + (inline[1]?.length ?? 0) + (inline[2]?.length ?? 0) + rest.indexOf(value);
        found.push(secretMatch(start, start + value.length));
      }
      continue;
    }

    const attached = LABEL_WITH_DELIMITER.exec(text);
    const label = (attached?.[1] ?? text.replace(/[^A-Za-z0-9_-]/g, '')).toLowerCase();
    const kind = SECRET_LABELS.get(label);
    if (!kind) continue;

    let hasDelimiter = attached !== null;
    let next = index + 1;
    while (next < spans.length && DELIMITER_WORD.test(spans[next]?.word.text ?? '')) {
      hasDelimiter = true;
      next += 1;
    }
    const value = spans[next];
    const plain = value?.word.text.replace(EDGE_PUNCTUATION, '') ?? '';
    if (!value || plain === '') continue;
    if (kind === 'delimited' && !hasDelimiter) continue;
    if (kind === 'digits' && !hasDelimiter && !/^\d{3,8}$/.test(plain)) continue;
    if (kind === 'bare' && plain.length < MIN_BEARER_LENGTH) continue;
    found.push(secretMatch(value.start, value.end));
  }
  return found;
}

// ---- assembling regions ------------------------------------------------------------------------

function overlaps(a: Match, b: Match): boolean {
  return a.start < b.end && b.start < a.end;
}

function resolve(matches: readonly Match[]): Match[] {
  const ordered = [...matches].sort(
    (a, b) => a.priority - b.priority || a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const accepted: Match[] = [];
  for (const candidate of ordered) {
    if (!accepted.some((existing) => overlaps(existing, candidate))) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

function spansOf(line: SensitiveLine): { text: string; spans: WordSpan[] } {
  const spans: WordSpan[] = [];
  let text = '';
  for (const word of line.words) {
    if (word.text.trim() === '') continue;
    if (text !== '') text += ' ';
    spans.push({ word, start: text.length, end: text.length + word.text.length });
    text += word.text;
  }
  return { text, spans };
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectOfMatch(found: Match, spans: readonly WordSpan[]): Rect | null {
  let rect: Rect | null = null;
  for (const span of spans) {
    if (span.end <= found.start || span.start >= found.end) continue;
    const length = Math.max(1, span.end - span.start);
    const from = Math.max(found.start, span.start) - span.start;
    const to = Math.min(found.end, span.end) - span.start;
    const { bbox } = span.word;
    rect = union(
      rect,
      from === 0 && to === length
        ? bbox
        : {
            x: bbox.x + (bbox.width * from) / length,
            y: bbox.y,
            width: (bbox.width * (to - from)) / length,
            height: bbox.height,
          },
    );
  }
  return rect;
}

function pad(rect: Rect, padding: number, bounds: Size | undefined): Rect {
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(bounds?.width ?? Infinity, rect.x + rect.width + padding);
  const bottom = Math.min(bounds?.height ?? Infinity, rect.y + rect.height + padding);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
}

/** Regions of the OCR lines that hold personal data, top to bottom, in image pixels. */
export function detectSensitiveRegions(
  lines: readonly SensitiveLine[],
  options: DetectOptions = {},
): SensitiveRegion[] {
  const padding = options.padding ?? DEFAULT_PADDING;
  const regions: SensitiveRegion[] = [];
  for (const line of lines) {
    const { text, spans } = spansOf(line);
    if (text === '') continue;
    const found = resolve([
      ...findCards(text),
      ...findIds(text),
      ...findEmails(text),
      ...findLabelledSecrets(spans),
      ...findTokens(spans),
      ...findPhones(text),
    ]);
    for (const entry of found) {
      const rect = rectOfMatch(entry, spans);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      regions.push({
        rect: pad(rect, padding, options.bounds),
        kind: entry.kind,
        label: entry.label,
      });
    }
  }
  return regions.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

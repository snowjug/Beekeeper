/**
 * Cleans up what Whisper heard before it is typed into another app:
 *
 * 1. Whisper "hears" phrases such as "Thank you." or "[Music]" in near-silent clips. Credits and
 *    sound annotations are always dropped; stock phrases only when the clip is short or quiet.
 * 2. Filler sounds (um, uh, hmm, Hindi अं / उम / हम्म) are removed.
 * 3. Spoken punctuation ("comma", "full stop", "new line", "कॉमा", "पूर्ण विराम", ...) becomes the
 *    mark itself, with correct spacing. Rules: a command is a whole word (or the whole phrase) in
 *    Whisper's text; it is plain text when it follows an article or possessive ("the comma", "a full
 *    stop") or the word "literal" ("literal comma" types "comma"). What Whisper punctuated around a
 *    command is replaced by it: the spoken mark wins. "full stop" and "पूर्ण विराम" type "।" when
 *    the sentence before them is Devanagari and "." otherwise.
 * 4. The first word, and the first word after a spoken full stop, question or exclamation mark or
 *    line break, starts with a capital letter (Latin script only; names such as iPhone, e-mail
 *    addresses and web addresses are left alone).
 */
import type { AudioFacts } from './audio';

export interface PostProcessOptions {
  /** Turn "comma", "full stop", "new line" (and the Hindi equivalents) into punctuation. */
  spokenPunctuation: boolean;
  /** Facts about the recording; without them stock phrases such as "Thank you." are kept. */
  audio?: AudioFacts;
}

/** A clip with less speech than this cannot be a sentence that Whisper understood. */
const MIN_VOICED_MS = 400;
const MIN_PEAK_RMS = 0.004;

// ---- hallucinations ------------------------------------------------------------------------

/** Lower-case words only: no punctuation, no symbols, single spaces (also used for the tables). */
function comparable(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u200c\u200d]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Sound annotations such as "[Music]", "(applause)", "*laughs*" or "♪ ♪" and nothing else. */
const ANNOTATION = /^(?:\s*(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪[^♪]*♪?|♫[^♫]*♫?)\s*)+$/u;

const CREDITS: readonly RegExp[] = [
  /^(?:sub)?titles? (?:by|made by|created by)\b/,
  /^(?:sub)?titled by\b/,
  /^(?:transcribed|transcription|captioned|captions|translated|translation) by\b/,
  /^(?:subtitles?|captions?) (?:provided|powered|brought)\b/,
  /\bamara org\b/,
  /^(?:sous titres|sous titrage|untertitel|untertitelung|subtitulado|legendas|sottotitoli|ondertitels)\b/,
  /^सबटाइटल/u,
];

const STOCK_PHRASES: readonly string[] = [
  'you',
  'thank you',
  'thanks',
  'thank you very much',
  'thank you so much',
  'thanks for watching',
  'thank you for watching',
  'thanks for watching this video',
  'thank you for watching this video',
  'see you next time',
  'see you in the next video',
  'please subscribe',
  'please subscribe to my channel',
  'like and subscribe',
  "don't forget to subscribe",
  'bye',
  'bye bye',
  'goodbye',
  'the end',
  "i'm sorry",
  'okay',
  'ok',
  'धन्यवाद',
  'शुक्रिया',
  'धन्यवाद दोस्तों',
  'शुक्रिया दोस्तों',
  'थैंक यू',
  'थैंक्यू',
  'बाय',
  'बाय बाय',
  'अलविदा',
  'अगले वीडियो में मिलते हैं',
  'वीडियो देखने के लिए धन्यवाद',
  'देखने के लिए धन्यवाद',
  'सब्सक्राइब करें',
  'चैनल को सब्सक्राइब करें',
  'चैनल को सब्सक्राइब कीजिए',
]
  .map(comparable)
  .sort((a, b) => b.length - a.length);

/** True when the text is nothing but stock phrases (one or more times). */
function isStockOnly(normalized: string): boolean {
  let rest = normalized;
  for (let round = 0; round < 6 && rest !== ''; round += 1) {
    const current = rest;
    const phrase = STOCK_PHRASES.find(
      (entry) => current === entry || current.startsWith(`${entry} `),
    );
    if (!phrase) return false;
    rest = rest.slice(phrase.length).trim();
  }
  return rest === '' && normalized !== '';
}

/** Annotations, credits and text without any letter or digit: never something the user said. */
function isArtefact(text: string): boolean {
  const normalized = comparable(text);
  if (normalized === '') return true;
  if (ANNOTATION.test(text.trim())) return true;
  return CREDITS.some((pattern) => pattern.test(normalized));
}

/** True when Whisper most likely invented this text from silence or noise. */
export function isHallucination(text: string, audio?: AudioFacts): boolean {
  if (isArtefact(text)) return true;
  if (!audio) return false;
  const quiet = audio.voicedMs < MIN_VOICED_MS || audio.peakRms < MIN_PEAK_RMS;
  return quiet && isStockOnly(comparable(text));
}

// ---- fillers -------------------------------------------------------------------------------

const BEFORE = String.raw`(?<![\p{L}\p{M}\p{N}'’-])`;
const AFTER = String.raw`(?![\p{L}\p{M}\p{N}'’-])`;
const FILLER_WORDS = String.raw`(?:u+m+|u+h+m*|h+m+|e+r+m+|er|अं|अँ|उम्म+|उम|उं|ऊं|ऊँ|हम्म+)`;
const FILLERS = new RegExp(`${BEFORE}${FILLER_WORDS}${AFTER}(?:\\s*[,;])?`, 'giu');

function stripFillers(text: string): string {
  // "UM" and "UH" written in capitals are acronyms, not hesitations.
  return text.replace(FILLERS, (match) => (/^\p{Lu}{2,}/u.test(match) ? match : ''));
}

// ---- spoken punctuation ----------------------------------------------------------------------

type Symbol =
  | { kind: 'mark'; text: string }
  | { kind: 'stop' }
  | { kind: 'hyphen' }
  | { kind: 'dash' }
  | { kind: 'open'; text: string }
  | { kind: 'close'; text: string }
  | { kind: 'break'; text: string };

interface Spoken {
  words: readonly string[];
  symbol: Symbol;
  hindi: boolean;
}

const mark = (text: string): Symbol => ({ kind: 'mark', text });
const STOP: Symbol = { kind: 'stop' };
const HYPHEN: Symbol = { kind: 'hyphen' };
const DASH: Symbol = { kind: 'dash' };
const open = (text: string): Symbol => ({ kind: 'open', text });
const close = (text: string): Symbol => ({ kind: 'close', text });
const lineBreak = (text: string): Symbol => ({ kind: 'break', text });

/** One word of a spoken command, compared case-insensitively and without joiners. */
function wordKey(word: string): string {
  return word
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u200c\u200d]/gu, '');
}

const ENGLISH: ReadonlyArray<readonly [string, Symbol]> = [
  ['comma', mark(',')],
  ['full stop', STOP],
  ['period', STOP],
  ['question mark', mark('?')],
  ['exclamation mark', mark('!')],
  ['exclamation point', mark('!')],
  ['colon', mark(':')],
  ['semicolon', mark(';')],
  ['semi colon', mark(';')],
  ['hyphen', HYPHEN],
  ['dash', DASH],
  ['open bracket', open('(')],
  ['open parenthesis', open('(')],
  ['close bracket', close(')')],
  ['close parenthesis', close(')')],
  ['open quote', open('"')],
  ['open quotes', open('"')],
  ['begin quote', open('"')],
  ['close quote', close('"')],
  ['close quotes', close('"')],
  ['end quote', close('"')],
  ['new line', lineBreak('\n')],
  ['newline', lineBreak('\n')],
  ['new paragraph', lineBreak('\n\n')],
  ['next paragraph', lineBreak('\n\n')],
];

const HINDI: ReadonlyArray<readonly [string, Symbol]> = [
  ['कॉमा', mark(',')],
  ['कोमा', mark(',')],
  ['कामा', mark(',')],
  ['अल्पविराम', mark(',')],
  ['अल्प विराम', mark(',')],
  ['पूर्ण विराम', STOP],
  ['पूर्णविराम', STOP],
  ['पुर्ण विराम', STOP],
  ['फुल स्टॉप', STOP],
  ['फुलस्टॉप', STOP],
  ['फुल स्टाप', STOP],
  ['प्रश्न चिह्न', mark('?')],
  ['प्रश्नचिह्न', mark('?')],
  ['प्रश्न चिन्ह', mark('?')],
  ['प्रश्नचिन्ह', mark('?')],
  ['प्रश्नवाचक चिह्न', mark('?')],
  ['क्वेश्चन मार्क', mark('?')],
  ['विस्मयादिबोधक चिह्न', mark('!')],
  ['विस्मयादिबोधक चिन्ह', mark('!')],
  ['विस्मयादि बोधक चिह्न', mark('!')],
  ['एक्सक्लेमेशन मार्क', mark('!')],
  ['नई लाइन', lineBreak('\n')],
  ['नयी लाइन', lineBreak('\n')],
  ['न्यू लाइन', lineBreak('\n')],
  ['नई पंक्ति', lineBreak('\n')],
  ['नयी पंक्ति', lineBreak('\n')],
  ['नया पैराग्राफ', lineBreak('\n\n')],
  ['न्यू पैराग्राफ', lineBreak('\n\n')],
  ['नया अनुच्छेद', lineBreak('\n\n')],
  ['कोलन', mark(':')],
  ['कॉलन', mark(':')],
  ['सेमीकोलन', mark(';')],
  ['सेमी कोलन', mark(';')],
  ['हाइफन', HYPHEN],
  ['हाइफ़न', HYPHEN],
  ['डैश', DASH],
];

/** "full stop" is also written "full-stop" and "fullstop": every spelling is its own command. */
function expand(entries: ReadonlyArray<readonly [string, Symbol]>, hindi: boolean): Spoken[] {
  const result: Spoken[] = [];
  for (const [phrase, symbol] of entries) {
    const words = phrase.split(' ').map(wordKey);
    result.push({ words, symbol, hindi });
    if (words.length > 1) {
      result.push({ words: [words.join('-')], symbol, hindi });
      result.push({ words: [words.join('')], symbol, hindi });
    }
  }
  return result;
}

/** Longest phrases first so "new paragraph" is never read as "new" + something. */
const COMMANDS: readonly Spoken[] = [...expand(ENGLISH, false), ...expand(HINDI, true)].sort(
  (a, b) => b.words.length - a.words.length,
);

/** After one of these a command word is an ordinary noun: "the comma", "a full stop". */
const DETERMINERS = new Set([
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their',
  'each',
  'every',
  'another',
]);

interface Chunk {
  lead: string;
  core: string;
  trail: string;
  key: string;
}

const EDGES = /^([^\p{L}\p{N}\p{M}]*)(.*?)([^\p{L}\p{N}\p{M}]*)$/su;
const SENTENCE_PUNCTUATION = /[,.;:!?…।]/gu;

function parseChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const raw of text.split(' ')) {
    if (raw === '') continue;
    const [, lead = '', core = '', trail = ''] = EDGES.exec(raw) ?? [];
    chunks.push({ lead, core, trail, key: wordKey(core) });
  }
  return chunks;
}

function matchAt(
  chunks: readonly Chunk[],
  index: number,
): { spoken: Spoken; length: number } | null {
  for (const spoken of COMMANDS) {
    const { words } = spoken;
    if (index + words.length > chunks.length) continue;
    const fits = words.every((word, offset) => {
      const chunk = chunks[index + offset];
      if (!chunk || chunk.key !== word) return false;
      // Punctuation inside the phrase ("full, stop") means it is not the command.
      if (offset < words.length - 1 && chunk.trail !== '') return false;
      return offset === 0 || chunk.lead === '';
    });
    if (fits) return { spoken, length: words.length };
  }
  return null;
}

/** Capitalises a lower-case Latin word; leaves iPhone, e.g. and github.com untouched. */
function capitalize(word: string): string {
  const match = /^([^\p{L}\p{N}]*)(\p{Ll})(.*)$/su.exec(word);
  if (!match) return word;
  const [, lead = '', first = '', rest = ''] = match;
  if (!/\p{Script=Latin}/u.test(first)) return word;
  if (/[\p{Lu}@/\\_]/u.test(rest) || /[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(word)) return word;
  return `${lead}${first.toLocaleUpperCase()}${rest}`;
}

/** The sentence-ending mark that fits the script of the text before it. */
function stopFor(before: string, hindiCommand: boolean): string {
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const char = before[index] ?? '';
    if (/\p{L}/u.test(char)) return /\p{Script=Devanagari}/u.test(char) ? '।' : '.';
  }
  return hindiCommand ? '।' : '.';
}

/** Puts words and marks together with the right spaces; punctuation Whisper attached is held back. */
class Writer {
  private out = '';
  private held = '';
  private glue = true;
  private capital = true;

  word(chunk: Chunk): void {
    if (chunk.core === '') {
      // Punctuation on its own belongs to the word before it (once: "wait... ..." is "wait...").
      const stray = chunk.lead + chunk.trail;
      if (!this.held.endsWith(stray)) this.held += stray;
      return;
    }
    this.flush();
    const text = `${chunk.lead}${chunk.core}`;
    this.append(this.capital ? capitalize(text) : text);
    this.held = chunk.trail;
    this.capital = false;
  }

  command(spoken: Spoken, last: Chunk): void {
    const { symbol } = spoken;
    // A spoken mark replaces what Whisper punctuated; quotes and brackets keep what came before.
    if (symbol.kind !== 'open' && symbol.kind !== 'close') {
      this.held = this.held.replace(SENTENCE_PUNCTUATION, '');
    }
    this.flush();
    switch (symbol.kind) {
      case 'mark':
        this.tight(symbol.text);
        this.capital = '.?!'.includes(symbol.text);
        break;
      case 'stop':
        this.tight(stopFor(this.out, spoken.hindi));
        this.capital = true;
        break;
      case 'hyphen':
        this.tight('-');
        this.glue = true;
        break;
      case 'dash':
        this.append('-');
        break;
      case 'open':
        this.append(symbol.text);
        this.glue = true;
        break;
      case 'close':
        this.tight(symbol.text);
        break;
      case 'break':
        this.out = this.out.replace(/[ \t]+$/u, '') + symbol.text;
        this.glue = true;
        this.capital = true;
        break;
    }
    // What Whisper put after a quote or bracket stays ("close quote," keeps its comma); the rest of
    // the marks were replaced by the spoken one.
    this.held =
      symbol.kind === 'open' || symbol.kind === 'close'
        ? last.trail
        : last.trail.replace(SENTENCE_PUNCTUATION, '');
  }

  text(): string {
    this.flush();
    return this.out.replace(/^[ \t]+|[ \t]+$/gu, '');
  }

  private flush(): void {
    this.out += this.held;
    this.held = '';
  }

  private append(text: string): void {
    this.out += this.out === '' || this.glue ? text : ` ${text}`;
    this.glue = false;
  }

  private tight(text: string): void {
    this.out = this.out.replace(/[ \t]+$/u, '') + text;
    this.glue = false;
  }
}

function write(text: string, commands: boolean): string {
  const chunks = parseChunks(text);
  const writer = new Writer();
  for (let index = 0; index < chunks.length;) {
    const chunk = chunks[index];
    if (!chunk) break;

    if (commands && chunk.key === 'literal' && chunk.trail === '') {
      const next = matchAt(chunks, index + 1);
      if (next) {
        for (let offset = 0; offset < next.length; offset += 1) {
          const word = chunks[index + 1 + offset];
          if (word) writer.word(word);
        }
        index += 1 + next.length;
        continue;
      }
    }

    const previous = chunks[index - 1];
    const noun = previous !== undefined && previous.trail === '' && DETERMINERS.has(previous.key);
    const found = commands && !noun ? matchAt(chunks, index) : null;
    if (found) {
      const last = chunks[index + found.length - 1] ?? chunk;
      writer.command(found.spoken, last);
      index += found.length;
      continue;
    }
    writer.word(chunk);
    index += 1;
  }
  return writer.text();
}

/** Spacing left over from Whisper's own punctuation and from removed fillers. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+([,.;:!?।])/gu, '$1')
    .replace(/([,;:])(?:[ \t]*\1)+/gu, '$1')
    .replace(/,[ \t]*([.?!।])(?!\.)/gu, '$1')
    .replace(/(?<!\.)\.\.(?!\.)/gu, '.')
    .replace(/[ \t]{2,}/gu, ' ');
}

/** The text to type for what Whisper heard; '' when there is nothing worth typing. */
export function postProcess(raw: string, options: PostProcessOptions): string {
  const text = raw
    .replace(/[\u200b\u2060\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (isHallucination(text, options.audio)) return '';

  // A filler at the start leaves its punctuation behind: "Um, hello" -> ", hello" -> "hello".
  const withoutFillers = stripFillers(text)
    .replace(/\s+/gu, ' ')
    .replace(/^[,;:.…\s]+/u, '')
    .trim();
  if (withoutFillers === '' || isHallucination(withoutFillers, options.audio)) return '';

  return tidy(write(withoutFillers, options.spokenPunctuation));
}

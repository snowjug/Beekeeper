/**
 * Text preparation for speech output: strips markup the voice must not read aloud, splits text into
 * sentences and into runs of one language (the natural voice speaks one language per call), and
 * detects the language of recognised text. Pure functions, shared by the main process and the UI.
 */

export type SpeechLang = 'en' | 'hi';

const DEVANAGARI_LETTER = /[\u0900-\u0963\u0966-\u097F]/;
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/;
const SENTENCE_END = /([.!?\u0964\u0965\u2026]+["')\]\u201D]*)(\s+|$)/;

export function isDevanagari(char: string): boolean {
  return DEVANAGARI_LETTER.test(char);
}

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI_LETTER.test(text);
}

/** 'hi' when Devanagari words are at least as many as Latin words (and any exist), else 'en'. */
export function detectLanguage(text: string): SpeechLang {
  let devanagari = 0;
  let latin = 0;
  for (const word of text.split(/\s+/)) {
    if (DEVANAGARI_LETTER.test(word)) devanagari += 1;
    else if (LATIN_LETTER.test(word)) latin += 1;
  }
  return devanagari > 0 && devanagari >= latin ? 'hi' : 'en';
}

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{E0020}-\u{E007F}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;

/** Removes markdown, URLs, emoji and symbols so the voice reads natural prose. */
export function cleanForSpeech(text: string, lang: SpeechLang = detectLanguage(text)): string {
  const percent = lang === 'hi' ? ' \u092A\u094D\u0930\u0924\u093F\u0936\u0924' : ' percent';
  const degrees = lang === 'hi' ? ' \u0921\u093F\u0917\u094D\u0930\u0940' : ' degrees';
  let out = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/<[^>\s][^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\|/g, ', ')
    .replace(EMOJI, '')
    .replace(/(\d)\s*\u00B0\s*C\b/g, `$1${degrees} Celsius`)
    .replace(/(\d)\s*\u00B0\s*F\b/g, `$1${degrees} Fahrenheit`)
    .replace(/\u00B0/g, degrees)
    .replace(/(\d)\s*%/g, `$1${percent}`)
    .replace(/\s*&\s*/g, lang === 'hi' ? ' \u0914\u0930 ' : ' and ')
    .replace(/\s*\u2192\s*/g, ', ')
    .replace(/[\u2022\u00B7]/g, ', ')
    .replace(/([.!?\u0964\u2026:;])[ \t]*[\r\n]+/g, '$1 ')
    .replace(/[\r\n]+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
  out = out.replace(/([.!?\u0964]),\s*/g, '$1 ').replace(/\.{2,}/g, '.');
  return out;
}

/**
 * Splits prose into sentences no longer than `maxLength` characters. Short fragments are merged
 * into the next sentence so the voice never speaks a single word on its own.
 */
export function splitSentences(text: string, maxLength = 240, minLength = 14): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > 0) {
    const match = SENTENCE_END.exec(rest);
    if (!match) {
      parts.push(rest);
      break;
    }
    const end = match.index + match[1]!.length;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(match.index + match[0].length).trim();
  }

  const wrapped: string[] = [];
  for (const part of parts) {
    let piece = part;
    while (piece.length > maxLength) {
      const window = piece.slice(0, maxLength);
      const cut = Math.max(
        window.lastIndexOf(', '),
        window.lastIndexOf('; '),
        window.lastIndexOf(' '),
      );
      const at = cut > maxLength / 3 ? cut + 1 : maxLength;
      wrapped.push(piece.slice(0, at).trim());
      piece = piece.slice(at).trim();
    }
    if (piece) wrapped.push(piece);
  }

  const merged: string[] = [];
  let carry = '';
  for (const piece of wrapped) {
    const candidate = carry ? `${carry} ${piece}` : piece;
    if (candidate.length < minLength && piece !== wrapped[wrapped.length - 1]) {
      carry = candidate;
      continue;
    }
    merged.push(candidate);
    carry = '';
  }
  if (carry) merged.push(carry);
  return merged;
}

export interface LangRun {
  text: string;
  lang: SpeechLang;
}

/**
 * Splits text into consecutive runs of one language by script (Devanagari = Hindi, everything else
 * = English). Digits, punctuation and spaces stay with the run they follow.
 */
export function splitScriptRuns(text: string): LangRun[] {
  const runs: LangRun[] = [];
  let pendingNeutral = '';
  for (const char of text) {
    let lang: SpeechLang | null = null;
    if (DEVANAGARI_LETTER.test(char)) lang = 'hi';
    else if (LATIN_LETTER.test(char)) lang = 'en';
    if (lang === null) {
      const last = runs[runs.length - 1];
      if (last) last.text += char;
      else pendingNeutral += char;
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.lang === lang) {
      last.text += char;
    } else {
      runs.push({ text: pendingNeutral + char, lang });
      pendingNeutral = '';
    }
  }
  if (runs.length === 0 && pendingNeutral.trim()) runs.push({ text: pendingNeutral, lang: 'en' });
  return runs.filter((run) => run.text.trim().length > 0);
}

/**
 * Everything the voice has to say, in order: cleaned text -> sentences -> language runs. Each chunk
 * is one synthesis call, so the first sentence can start playing while the rest is still rendering.
 */
export function speechChunks(
  text: string,
  options: { forceLang?: SpeechLang; maxLength?: number } = {},
): LangRun[] {
  const cleaned = cleanForSpeech(text);
  const chunks: LangRun[] = [];
  for (const sentence of splitSentences(cleaned, options.maxLength)) {
    if (options.forceLang) {
      chunks.push({ text: sentence, lang: options.forceLang });
      continue;
    }
    const runs = splitScriptRuns(sentence);
    // A one- or two-letter Latin fragment inside Hindi (a unit, "ok") is spoken with the Hindi voice.
    for (const run of runs) {
      const previous = chunks[chunks.length - 1];
      const isTinyLatin = run.lang === 'en' && run.text.replace(/[^A-Za-z]/g, '').length <= 2;
      if (previous && isTinyLatin && previous.lang === 'hi') previous.text += run.text;
      else chunks.push({ ...run });
    }
  }
  return chunks.filter((chunk) => /[\p{L}\p{N}]/u.test(chunk.text));
}

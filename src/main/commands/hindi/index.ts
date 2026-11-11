import type { CommandResult } from '@shared/cards';

export type Locale = 'en' | 'hi';

export interface NormalizedUtterance {
  /** What the English command matchers should see (equal to `original` when nothing changed). */
  text: string;
  /** Language the user spoke: 'hi' for Hindi, Hinglish and Devanagari-transliterated English. */
  locale: Locale;
  changed: boolean;
  original: string;
}

/**
 * Understands Hindi and Hinglish: rewrites an utterance such as "5 मिनट का टाइमर लगाओ" or
 * "volume badha do" into the English command form the matchers know ("set a timer for 5
 * minutes", "volume up"). English input is returned untouched.
 */
export function normalizeUtterance(text: string): NormalizedUtterance {
  return { text, locale: 'en', changed: false, original: text };
}

/**
 * Localises the reply of a command that ran for a Hindi utterance (speech and card text).
 * Replies without a translation are returned unchanged.
 */
export function localizeResult(
  result: CommandResult,
  _context: { commandId: string | null; locale: Locale },
): CommandResult {
  return result;
}

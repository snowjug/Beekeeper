export type Locale = 'en' | 'hi';

export interface NormalizedUtterance {
  /** What the English command matchers should see (equal to `original` when nothing changed). */
  text: string;
  /** Language the user spoke: 'hi' for Hindi, Hinglish and Devanagari-transliterated English. */
  locale: Locale;
  changed: boolean;
  original: string;
}

import { detectLocale } from './detect';
import { glossUtterance } from './gloss';
import { translate } from './rules';
import type { NormalizedUtterance } from './types';
import { Utterance } from './utterance';

/** Commands are short: a longer utterance is a question or a dictation for the AI, not worth rewriting. */
const MAX_COMMAND_LENGTH = 400;

function unchanged(text: string, locale: NormalizedUtterance['locale']): NormalizedUtterance {
  return { text, locale, changed: false, original: text };
}

/**
 * Understands Hindi and Hinglish: rewrites an utterance such as "5 मिनट का टाइमर लगाओ" or
 * "volume badha do" into the English command form the matchers know ("set a timer for 5
 * minutes", "volume up"). English input is returned untouched.
 */
export function normalizeUtterance(text: string): NormalizedUtterance {
  const locale = detectLocale(text);
  if (locale === 'en' || text.length > MAX_COMMAND_LENGTH) return unchanged(text, locale);
  try {
    const utterance = Utterance.from(text);
    const english = translate(utterance)?.english ?? glossUtterance(utterance);
    if (english === null || english === text) return unchanged(text, 'hi');
    return { text: english, locale: 'hi', changed: true, original: text };
  } catch {
    return unchanged(text, 'hi');
  }
}

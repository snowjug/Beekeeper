/** Tells Hindi / Hinglish from English before any work is done on an utterance. */
import { hasDevanagari } from './script';

/**
 * Romanised Hindi words that are not English words. One of them makes a Latin-script utterance
 * Hinglish; ambiguous words (do, me, band, kam, to ...) are deliberately not here.
 */
const HINGLISH_MARKERS: ReadonlySet<string> = new Set(
  (
    'kya kyun kyon kaise kaisa kaisi kitna kitne kitni kab kahan kaun hai hain hoga hogi honge tha thi ' +
    'ka ki ke ko mein mujhe mujhko mera meri mere aap tum abhi aaj kal parso subah shaam raat dopahar ' +
    'baje karo kar kardo karna kijiye kijiyega batao bata bataiye dikhao dikha dikhaiye kholo khol kholiye ' +
    'badhao badha ghatao ghata laga lagao lagana lagado chalao chala chalu shuru ruko roko hatao mitao ' +
    'sunao likho dhundo khojo liye aur nahi nahin bhi toh wala wali wale mausam samay tareekh ' +
    'ghanta ghante minat awaz awaaz barish baarish garmi thand lo haan theek thik bilkul zaroor dobara ' +
    'zara thoda sab sabhi bahut bohot dijiye dena dedo chup yaad dilao dilana badlo bandh kholna'
  ).split(' '),
);

const LATIN_WORD = /[a-z]+(?:['\u2019-][a-z]+)*/g;

/** 'hi' for Devanagari text and for Latin text with a romanised Hindi word, otherwise 'en'. */
export function detectLocale(text: string): 'en' | 'hi' {
  if (hasDevanagari(text)) return 'hi';
  const words = text.toLowerCase().match(LATIN_WORD);
  if (words === null) return 'en';
  return words.some((word) => HINGLISH_MARKERS.has(word)) ? 'hi' : 'en';
}

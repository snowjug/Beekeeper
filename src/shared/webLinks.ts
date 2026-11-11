/** Builders for the web links Circle to Search opens (Bing search / translator / visual search, mailto). */

export const BING_VISUAL_SEARCH_URL = 'https://www.bing.com/visualsearch';

const BING_SEARCH_URL = 'https://www.bing.com/search';
const BING_TRANSLATE_URL = 'https://www.bing.com/translator';

/** Longest query text (in characters) that is ever put into a link. */
export const MAX_URL_TEXT_LENGTH = 1000;

// parseSafeExternalUrl rejects anything above 2048 characters; leave room for the fixed part.
const MAX_ENCODED_LENGTH = 1800;
const MIN_WORD_BOUNDARY_RATIO = 0.6;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

const EMAIL_LOCAL = /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*$/;
const EMAIL_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const EMAIL_TLD = /^(?:[A-Za-z]{2,24}|xn--[A-Za-z0-9-]{2,59})$/;

/**
 * Cleans text for use as a query: strips control characters and broken surrogates, collapses
 * whitespace and cuts it to `maxLength` code points (preferably at a word boundary) so the
 * encoded query always fits into a URL accepted by parseSafeExternalUrl.
 */
export function truncateForUrl(text: string, maxLength = MAX_URL_TEXT_LENGTH): string {
  const cleaned = text
    .replace(LONE_SURROGATE, '\ufffd')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const codePoints = Array.from(cleaned);
  const requested = Number.isFinite(maxLength) ? Math.floor(maxLength) : MAX_URL_TEXT_LENGTH;
  let limit = Math.max(0, Math.min(codePoints.length, requested));
  if (limit < codePoints.length || encodeURIComponent(cleaned).length > MAX_ENCODED_LENGTH) {
    limit = fitEncodedLength(codePoints, limit);
    return cutAtWordBoundary(codePoints, limit);
  }
  return cleaned;
}

function fitEncodedLength(codePoints: readonly string[], limit: number): number {
  let low = 0;
  let high = limit;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encodeURIComponent(codePoints.slice(0, middle).join('')).length <= MAX_ENCODED_LENGTH) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function cutAtWordBoundary(codePoints: readonly string[], limit: number): string {
  const cut = codePoints.slice(0, limit);
  if (limit === codePoints.length) return cut.join('').trim();
  // A cut inside a word leaves a meaningless fragment; fall back to the previous space when it is close.
  if (codePoints[limit] !== ' ') {
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= limit * MIN_WORD_BOUNDARY_RATIO)
      return cut.slice(0, lastSpace).join('').trim();
  }
  return cut.join('').trim();
}

export function buildBingSearchUrl(text: string): string {
  return `${BING_SEARCH_URL}?q=${encodeURIComponent(truncateForUrl(text))}`;
}

/** Bing Translator link that auto-detects the source language. Unknown language codes fall back to English. */
export function buildBingTranslateUrl(text: string, targetLang = 'en'): string {
  const target = LANGUAGE_CODE.test(targetLang) ? targetLang : 'en';
  const query = encodeURIComponent(truncateForUrl(text));
  return `${BING_TRANSLATE_URL}?text=${query}&from=auto&to=${encodeURIComponent(target)}`;
}

/** Conservative e-mail address check (no quoted local parts, no IP literals, no comments). */
export function isValidEmailAddress(address: string): boolean {
  if (address.length < 6 || address.length > 254) return false;
  const at = address.indexOf('@');
  if (at < 1 || at !== address.lastIndexOf('@')) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (local.length > 64 || !EMAIL_LOCAL.test(local) || domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => EMAIL_LABEL.test(label))) return false;
  return EMAIL_TLD.test(labels[labels.length - 1] ?? '');
}

/** `mailto:` link for a validated address, or null when the address is not acceptable. */
export function buildMailtoUrl(address: string): string | null {
  const trimmed = address.trim();
  if (!isValidEmailAddress(trimmed)) return null;
  const at = trimmed.indexOf('@');
  return `mailto:${trimmed.slice(0, at).replace(/%/g, '%25')}@${trimmed.slice(at + 1)}`;
}

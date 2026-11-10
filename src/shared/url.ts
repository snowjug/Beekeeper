const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Parses a URL that is safe to hand to shell.openExternal.
 * Only http(s) URLs without embedded credentials are accepted.
 */
export function parseSafeExternalUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH || CONTROL_CHARS.test(trimmed)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol) || url.hostname.length === 0) return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  return url;
}

export function isSafeExternalUrl(input: string): boolean {
  return parseSafeExternalUrl(input) !== null;
}

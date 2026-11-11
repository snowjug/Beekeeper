import { parseSafeExternalUrl } from '@shared/url';

export interface Website {
  /** Absolute http(s) URL, safe for shell.openExternal. */
  url: string;
  /** Lower-case host name, e.g. "news.ycombinator.com". */
  host: string;
}

/**
 * Extensions that look like a top-level domain but are far more likely a file name or a technology
 * ("readme.md", "node.js", "setup.exe"): they are never treated as websites.
 */
const FILE_LIKE_SUFFIXES: ReadonlySet<string> = new Set([
  '7z',
  'bat',
  'cmd',
  'css',
  'csv',
  'dll',
  'doc',
  'docx',
  'exe',
  'gif',
  'htm',
  'html',
  'ini',
  'jpeg',
  'jpg',
  'js',
  'json',
  'lnk',
  'log',
  'md',
  'mp3',
  'mp4',
  'msi',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'ps1',
  'py',
  'sh',
  'ts',
  'txt',
  'wav',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip',
]);

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;
const MAX_HOST_LENGTH = 253;

/** A registrable-looking host name: two or more valid labels and a letters-only (or punycode) TLD. */
export function isValidDomain(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return false;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  const tld = labels[labels.length - 1] ?? '';
  return TLD.test(tld) && !FILE_LIKE_SUFFIXES.has(tld);
}

/**
 * Turns "github.com", "example.org/page" or "https://news.ycombinator.com" into a website; `https://`
 * is added when missing. Only http(s) is accepted. Bare words, IP addresses and localhost are not.
 */
export function parseWebsite(token: string): Website | null {
  if (token.length === 0 || /\s/.test(token)) return null;
  const scheme = SCHEME.exec(token);
  if (scheme !== null && !['http', 'https'].includes((scheme[1] ?? '').toLowerCase())) return null;
  const parsed = parseSafeExternalUrl(scheme === null ? `https://${token}` : token);
  if (parsed === null || !isValidDomain(parsed.hostname)) return null;
  return { url: parsed.href, host: parsed.hostname };
}

/** Finds `token` (compared case-insensitively) in the original text to keep the case of paths and queries. */
export function restoreCase(raw: string, token: string): string {
  const parts = raw.trim().split(/\s+/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = (parts[index] ?? '').replace(/[\s?!.,;:]+$/, '');
    if (part.toLowerCase() === token.toLowerCase()) return part;
  }
  return token;
}

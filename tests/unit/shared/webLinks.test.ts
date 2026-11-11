import { describe, expect, it } from 'vitest';
import { parseSafeExternalUrl } from '@shared/url';
import {
  BING_VISUAL_SEARCH_URL,
  MAX_URL_TEXT_LENGTH,
  buildBingSearchUrl,
  buildBingTranslateUrl,
  buildMailtoUrl,
  isValidEmailAddress,
  truncateForUrl,
} from '@shared/webLinks';

function queryOf(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

const SCRIPT_URL = 'javascript:alert(1)'; // eslint-disable-line no-script-url

describe('truncateForUrl', () => {
  it.each<[string, string, string]>([
    ['collapses whitespace and line breaks', '  hello \n\t world   again ', 'hello world again'],
    ['strips control characters', 'a\u0000b\u0007c\u009fd', 'a b c d'],
    ['repairs lone surrogates', 'ok\ud83d tail', 'ok\ufffd tail'],
    ['keeps emoji intact', 'hi 👋🏽 there', 'hi 👋🏽 there'],
    ['returns an empty string for blank input', ' \n ', ''],
  ])('%s', (_name, input, expected) => {
    expect(truncateForUrl(input)).toBe(expected);
  });

  it('cuts to the limit at a word boundary when one is close', () => {
    expect(truncateForUrl('alpha beta gamma delta', 18)).toBe('alpha beta gamma');
  });

  it('cuts inside a very long word', () => {
    expect(truncateForUrl('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });

  it('counts code points, never splitting a surrogate pair', () => {
    const cut = truncateForUrl('😀'.repeat(20), 5);
    expect(Array.from(cut)).toHaveLength(5);
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });

  it('limits to 1000 characters by default', () => {
    expect(truncateForUrl('word '.repeat(400)).length).toBeLessThanOrEqual(MAX_URL_TEXT_LENGTH);
  });

  it('keeps the encoded query short for scripts that need 9 bytes per character', () => {
    const cut = truncateForUrl('漢'.repeat(1000));
    expect(encodeURIComponent(cut).length).toBeLessThanOrEqual(1800);
    expect(cut.length).toBeGreaterThan(100);
  });

  it('falls back to the default limit for a non-finite maximum', () => {
    expect(truncateForUrl('a'.repeat(2000), Number.NaN)).toHaveLength(MAX_URL_TEXT_LENGTH);
  });
});

describe('buildBingSearchUrl', () => {
  it('searches Bing over https', () => {
    const url = buildBingSearchUrl('hello world');
    expect(url).toBe('https://www.bing.com/search?q=hello%20world');
    expect(parseSafeExternalUrl(url)).not.toBeNull();
  });

  it.each([
    'a & b = c',
    'what is 100% of 50?',
    'C# vs C++ #1',
    'ünïcödé 日本語 🙂',
    'path/to\\file "quoted" <tag>',
    SCRIPT_URL,
    'line one\nline two',
  ])('round-trips the query %j', (text) => {
    const url = buildBingSearchUrl(text);
    expect(parseSafeExternalUrl(url)).not.toBeNull();
    expect(new URL(url).origin).toBe('https://www.bing.com');
    expect(queryOf(url, 'q')).toBe(text.replace(/\s+/g, ' ').trim());
  });

  it('handles empty text', () => {
    const url = buildBingSearchUrl('   ');
    expect(url).toBe('https://www.bing.com/search?q=');
    expect(parseSafeExternalUrl(url)).not.toBeNull();
  });

  it.each([
    ['plain text', 'lorem ipsum dolor '.repeat(500)],
    ['CJK text', '日本語のテキスト'.repeat(400)],
    ['emoji', '🙂'.repeat(900)],
    ['symbols that expand to three bytes each', '%&?#'.repeat(500)],
  ])('always produces a link parseSafeExternalUrl accepts (%s)', (_name, text) => {
    expect(parseSafeExternalUrl(buildBingSearchUrl(text))).not.toBeNull();
    expect(parseSafeExternalUrl(buildBingTranslateUrl(text, 'zh-Hans'))).not.toBeNull();
  });

  it('survives lone surrogates', () => {
    expect(() => buildBingSearchUrl('broken \ud83d surrogate \ude00')).not.toThrow();
  });
});

describe('buildBingTranslateUrl', () => {
  it('auto-detects the source and targets English by default', () => {
    const url = buildBingTranslateUrl('Bonjour le monde');
    expect(url).toBe('https://www.bing.com/translator?text=Bonjour%20le%20monde&from=auto&to=en');
    expect(parseSafeExternalUrl(url)).not.toBeNull();
  });

  it.each(['fr', 'de', 'zh-Hans', 'zh-Hant', 'pt-pt', 'sr-Cyrl'])(
    'accepts the target %s',
    (lang) => {
      const url = buildBingTranslateUrl('hello', lang);
      expect(queryOf(url, 'to')).toBe(lang);
      expect(queryOf(url, 'from')).toBe('auto');
      expect(queryOf(url, 'text')).toBe('hello');
    },
  );

  it.each(['', 'e', 'en&to=fr', SCRIPT_URL, 'x'.repeat(12), 'en us', 'en-', '../en'])(
    'replaces the invalid target %j by English',
    (lang) => {
      const url = buildBingTranslateUrl('hello', lang);
      expect(queryOf(url, 'to')).toBe('en');
      expect(new URL(url).searchParams.getAll('to')).toEqual(['en']);
    },
  );

  it('cuts long text', () => {
    const url = buildBingTranslateUrl('abc '.repeat(1000));
    expect((queryOf(url, 'text') ?? '').length).toBeLessThanOrEqual(MAX_URL_TEXT_LENGTH);
  });
});

describe('Bing links', () => {
  it('only ever point at https://www.bing.com', () => {
    for (const url of [
      BING_VISUAL_SEARCH_URL,
      buildBingSearchUrl('x'),
      buildBingTranslateUrl('x', 'fr'),
    ]) {
      const parsed = parseSafeExternalUrl(url);
      expect(parsed?.protocol).toBe('https:');
      expect(parsed?.hostname).toBe('www.bing.com');
    }
    expect(BING_VISUAL_SEARCH_URL).toBe('https://www.bing.com/visualsearch');
  });
});

describe('isValidEmailAddress / buildMailtoUrl', () => {
  it.each([
    'john@example.com',
    'john.doe+tag@sub.example.co.uk',
    'first_last-1@example-site.org',
    'a%b@example.io',
    'user@xn--bcher-kva.example',
    'USER@EXAMPLE.COM',
  ])('accepts %s', (address) => {
    expect(isValidEmailAddress(address)).toBe(true);
    expect(buildMailtoUrl(address)).not.toBeNull();
  });

  it.each([
    '',
    'plain',
    '@example.com',
    'john@',
    'john@example',
    'john@@example.com',
    'jo hn@example.com',
    'john@exam ple.com',
    '.john@example.com',
    'john.@example.com',
    'jo..hn@example.com',
    'john@-example.com',
    'john@example-.com',
    'john@example.c',
    'john@example.c0m',
    'john@[127.0.0.1]',
    'john@example.com?subject=hi',
    'john@example.com,eve@evil.com',
    'john@example.com\nBcc: eve@evil.com',
    '"john"@example.com',
    `${'a'.repeat(65)}@example.com`,
    `john@${'a'.repeat(64)}.com`,
    `john@${'a.'.repeat(130)}com`,
  ])('rejects %j', (address) => {
    expect(isValidEmailAddress(address)).toBe(false);
    expect(buildMailtoUrl(address)).toBeNull();
  });

  it('builds a mailto link without touching the domain and with the local part escaped', () => {
    expect(buildMailtoUrl('john.doe@example.com')).toBe('mailto:john.doe@example.com');
    expect(buildMailtoUrl('  padded@example.com \n')).toBe('mailto:padded@example.com');
    expect(buildMailtoUrl('a%20b@example.com')).toBe('mailto:a%2520b@example.com');
  });
});

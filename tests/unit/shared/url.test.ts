import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl, parseSafeExternalUrl } from '@shared/url';

describe('parseSafeExternalUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?q=1#frag',
    '  https://www.bing.com/search?q=hello%20world  ',
    'https://localhost:8080/a',
  ])('accepts %s', (input) => {
    expect(parseSafeExternalUrl(input)).toBeInstanceOf(URL);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)', // eslint-disable-line no-script-url
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'ms-settings:network',
    'vbscript:msgbox(1)',
    'ftp://example.com',
    'example.com',
    'https://user:pass@example.com',
    'https://exa\nmple.com',
    'https://',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('rejects %j', (input) => {
    expect(parseSafeExternalUrl(input)).toBeNull();
    expect(isSafeExternalUrl(input)).toBe(false);
  });

  it('normalises the parsed url', () => {
    expect(parseSafeExternalUrl(' HTTPS://Example.COM/a b ')?.href).toBe(
      'https://example.com/a%20b',
    );
  });
});

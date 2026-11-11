import { describe, expect, it } from 'vitest';
import { maskSecret, redactString, redactValue } from '@shared/redact';

describe('redactString', () => {
  it.each([
    ['key sk-abcdefghijklmnopqrstuvwxyz123456 end', 'key [redacted] end'],
    ['Authorization: Bearer abcdefghijklmnop.qrstuvwx.yz', 'Authorization: Bearer [redacted]'],
    ['api-key=supersecretvalue123', 'api-key=[redacted]'],
    ['apikey: "abc123def456"', 'apikey=[redacted]'],
    [
      'Ocp-Apim-Subscription-Key: 0123456789abcdef0123456789abcdef',
      'Ocp-Apim-Subscription-Key=[redacted]',
    ],
    ['hex 0123456789abcdef0123456789abcdef here', 'hex [redacted] here'],
    [
      'DefaultEndpointsProtocol=https;AccountKey=abcdefghijklmnopqrstuvwxyz0123==;',
      'DefaultEndpointsProtocol=https;AccountKey=[redacted];',
    ],
  ])('redacts secrets in %j', (input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it('leaves ordinary text alone', () => {
    expect(redactString('Opening Notepad for the user at 3:30 PM')).toBe(
      'Opening Notepad for the user at 3:30 PM',
    );
  });
});

describe('redactValue', () => {
  it('redacts values under sensitive keys at any depth without mutating the input', () => {
    const input = {
      ok: 'fine',
      apiKey: 'abc',
      nested: { token: 'xyz', list: [{ password: 'p' }, 'sk-abcdefghijklmnopqrstuvwxyz1234'] },
      empty: { secret: '' },
    };
    const result = redactValue(input) as typeof input;
    expect(result.ok).toBe('fine');
    expect(result.apiKey).toBe('[redacted]');
    expect(result.nested.token).toBe('[redacted]');
    expect(result.nested.list[0]).toEqual({ password: '[redacted]' });
    expect(result.nested.list[1]).toBe('[redacted]');
    expect(result.empty.secret).toBe('');
    expect(input.apiKey).toBe('abc');
  });

  it('keeps error identity but scrubs message and stack', () => {
    const error = new TypeError('bad key sk-abcdefghijklmnopqrstuvwxyz1234');
    const result = redactValue(error) as Error;
    expect(result).toBeInstanceOf(Error);
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('bad key [redacted]');
    expect(result.stack).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234');
  });

  it('passes primitives through and bounds recursion', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBeNull();
    const circularish: Record<string, unknown> = {};
    let cursor = circularish;
    for (let i = 0; i < 10; i += 1) {
      const next: Record<string, unknown> = {};
      cursor['child'] = next;
      cursor = next;
    }
    expect(JSON.stringify(redactValue(circularish))).toContain('[truncated]');
  });
});

describe('maskSecret', () => {
  it('shows only the last four characters', () => {
    expect(maskSecret('abcdefgh1234')).toBe('••••••••1234');
    expect(maskSecret('abc')).toBe('••••');
  });
});

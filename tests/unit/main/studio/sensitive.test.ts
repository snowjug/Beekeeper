import { describe, expect, it } from 'vitest';
import { detectSensitiveRegions, passesLuhn, type SensitiveLine } from '@main/studio/sensitive';

const CHAR = 10;
const HEIGHT = 20;

/** Words laid out left to right: 10 px per character and a 10 px gap, on a line at y = 100. */
function line(text: string, y = 100): SensitiveLine {
  let x = 0;
  return {
    words: text
      .split(' ')
      .filter(Boolean)
      .map((word) => {
        const bbox = { x, y, width: word.length * CHAR, height: HEIGHT };
        x += (word.length + 1) * CHAR;
        return { text: word, bbox };
      }),
  };
}

/** What the regions of a single line cover, as [kind, text] pairs. Text must use single spaces. */
function found(text: string): Array<[string, string]> {
  return detectSensitiveRegions([line(text)], { padding: 0 }).map((region) => [
    region.kind,
    text.slice(region.rect.x / CHAR, (region.rect.x + region.rect.width) / CHAR),
  ]);
}

describe('passesLuhn', () => {
  it.each(['4111111111111111', '5500000000000004', '378282246310005', '6011000990139424'])(
    'accepts the test card number %s',
    (digits) => {
      expect(passesLuhn(digits)).toBe(true);
    },
  );

  it.each(['4111111111111112', '1234567890123456', '', '4111 1111 1111 1111', '12a4'])(
    'rejects "%s"',
    (digits) => {
      expect(passesLuhn(digits)).toBe(false);
    },
  );
});

describe('e-mail addresses', () => {
  it.each([
    ['Contact john.doe@example.com today', 'john.doe@example.com'],
    ['a_b+tag@sub.domain.co.in', 'a_b+tag@sub.domain.co.in'],
    ['EMAIL: USER@EXAMPLE.ORG', 'USER@EXAMPLE.ORG'],
    ['Send to me@x.io.', 'me@x.io'],
  ])('finds the address in "%s"', (text, address) => {
    expect(found(text)).toEqual([['email', address]]);
  });

  it.each(['user@localhost', 'at sign @ alone', 'twitter @handle here', 'not an email: a@b'])(
    'ignores "%s"',
    (text) => {
      expect(found(text)).toEqual([]);
    },
  );

  it('blurs only the address inside a word such as "mail:john@x.com"', () => {
    expect(found('mail:john@x.com')).toEqual([['email', 'john@x.com']]);
  });
});

describe('card numbers', () => {
  it.each([
    ['4111 1111 1111 1111', 'Visa test number'],
    ['4111-1111-1111-1111', 'dashes'],
    ['4111111111111111', 'no separators'],
    ['5500 0000 0000 0004', 'Mastercard'],
    ['3782 822463 10005', 'American Express groups of 4-6-5'],
    ['6011 0009 9013 9424', 'Discover'],
    ['4012888888881881', 'Visa, 16 digits'],
  ])('finds %s (%s)', (number) => {
    expect(found(`Card ${number} expires 12/27`)).toEqual([['card', number]]);
  });

  it.each([
    '4111 1111 1111 1112',
    '1234 5678 9012 3456',
    '0000 0000 0000 0000',
    '1111 1111 1111 1111',
    '4111 1111',
    'Total 4111',
  ])('does not take "%s" for a card', (text) => {
    expect(found(text).filter(([kind]) => kind === 'card')).toEqual([]);
  });

  it('picks the card out of a longer chain of numbers', () => {
    expect(found('Ref 12345 4111 1111 1111 1111')).toEqual([['card', '4111 1111 1111 1111']]);
  });

  it('covers every word of the number as one region', () => {
    const regions = detectSensitiveRegions([line('Pay 4111 1111 1111 1111 now')], { padding: 0 });
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      kind: 'card',
      label: 'Card number',
      rect: { x: 40, y: 100, width: 190, height: HEIGHT },
    });
  });
});

describe('phone numbers', () => {
  it.each([
    '+91 98765 43210',
    '+91-98765-43210',
    '98765 43210',
    '9876543210',
    '+1 (415) 555-2671',
    '(415) 555-2671',
    '415-555-2671',
    '415.555.2671',
    '+44 20 7946 0958',
    '+49 30 901820',
  ])('finds %s', (number) => {
    expect(found(`Call ${number} now`)).toEqual([['phone', number]]);
  });

  it.each([
    '2026-11-11',
    '13:45:12',
    '192.168.100.200',
    '10.0.19045.5555',
    '$12,345,678.90',
    'Order 1234567',
    'Year 2026',
    'Room 12345',
    'v1.2.3.4',
  ])('ignores "%s"', (text) => {
    expect(found(text)).toEqual([]);
  });
});

describe('ID numbers', () => {
  it.each(['2345 6789 0123', '2345-6789-0123', '234567890123', '9123 4567 8901'])(
    'finds the Aadhaar-like number %s',
    (number) => {
      expect(found(`ID ${number} issued`)).toEqual([['id', number]]);
    },
  );

  it.each(['1234 5678 9012', '0234 5678 9012', '2345 6789', '2345 6789 0123 4'])(
    'ignores %s',
    (number) => {
      expect(found(`ID ${number}`).filter(([kind]) => kind === 'id')).toEqual([]);
    },
  );

  it('calls a plain 12-digit number that starts with the +91 country code a phone number', () => {
    expect(found('Mobile 919876543210')).toEqual([['phone', '919876543210']]);
  });
});

describe('passwords, one-time codes and keys', () => {
  it.each([
    ['password: hunter2', 'hunter2'],
    ['Password : hunter2', 'hunter2'],
    ['Password = hunter2', 'hunter2'],
    ['password:hunter2', 'hunter2'],
    ['pwd=abc123', 'abc123'],
    ['pwd: abc123', 'abc123'],
    ['Your password is hunter2', 'hunter2'],
    ['passcode: 8841', '8841'],
    ['OTP 482913', '482913'],
    ['Your OTP is 482913', '482913'],
    ['otp: 4829', '4829'],
    ['CVV: 123', '123'],
    ['cvv 123', '123'],
    ['PIN 1234', '1234'],
    ['Bearer abcdef1234567890abcd', 'abcdef1234567890abcd'],
    ['api_key=sk12345', 'sk12345'],
  ])('finds the value in "%s"', (text, value) => {
    expect(found(text)).toEqual([['secret', value]]);
  });

  it.each([
    'Forgot password? Click here',
    'password reset link',
    'Enter your password below',
    'OTP expires in 5 minutes',
    'Enter the OTP sent to you',
    'the secret garden',
    'pin the tab',
    'run pwd to see the folder',
    'Bearer short',
    'password:',
  ])('does not blur anything in "%s"', (text) => {
    expect(found(text)).toEqual([]);
  });

  it.each([
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234',
    'sk-proj-AbCdEf1234567890AbCdEf12',
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij',
    'AIzaSyA-1234567890abcdefghijklmnopqrstu',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'd41d8cd98f00b204e9800998ecf8427e',
    'Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmdo',
  ])('finds the key or token %s', (token) => {
    expect(found(`key ${token} end`)).toEqual([['secret', token]]);
  });

  it.each([
    'internationalization',
    'SOME_LONG_CONSTANT_NAME_V2_FINAL',
    'https://example.com/path/to/some/very/long/resource123456',
    'C:\\Users\\someone\\Documents\\report-2024-final.docx',
    'abcdefghijklmnopqrstuvwxyz',
    '12345678901234567890123456',
    'short1234token',
  ])('does not take "%s" for a key', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('strips quotes and trailing punctuation around a token', () => {
    expect(found('token="d41d8cd98f00b204e9800998ecf8427e",')).toEqual([
      ['secret', 'd41d8cd98f00b204e9800998ecf8427e'],
    ]);
  });
});

describe('detectSensitiveRegions', () => {
  it('returns nothing for an empty line, blank words and plain text', () => {
    expect(detectSensitiveRegions([])).toEqual([]);
    expect(detectSensitiveRegions([{ words: [] }, line('   ')])).toEqual([]);
    expect(found('The quick brown fox jumps over 13 lazy dogs')).toEqual([]);
  });

  it('keeps the highest-priority match when two overlap', () => {
    // A card number is also a run of digits that a phone pattern could grab.
    expect(found('4111 1111 1111 1111')).toEqual([['card', '4111 1111 1111 1111']]);
    // An e-mail address wins over the token pattern.
    expect(found('someone.with.a.long.name@example-domain-name.com')).toEqual([
      ['email', 'someone.with.a.long.name@example-domain-name.com'],
    ]);
  });

  it('finds several kinds on several lines and sorts them top to bottom', () => {
    const regions = detectSensitiveRegions(
      [
        line('Phone 415-555-2671', 300),
        line('Mail anna@example.com', 100),
        line('password: hunter2', 200),
      ],
      { padding: 0 },
    );
    expect(regions.map((region) => [region.kind, region.rect.y])).toEqual([
      ['email', 100],
      ['secret', 200],
      ['phone', 300],
    ]);
    expect(regions.map((region) => region.label)).toEqual([
      'Email address',
      'Password or secret',
      'Phone number',
    ]);
  });

  it('pads the regions and keeps them inside the image', () => {
    const regions = detectSensitiveRegions([line('anna@example.com', 4)], {
      padding: 6,
      bounds: { width: 150, height: 40 },
    });
    expect(regions).toHaveLength(1);
    const [region] = regions;
    expect(region?.rect.x).toBe(0);
    expect(region?.rect.y).toBe(0);
    expect(region?.rect.width).toBe(150);
    expect(region?.rect.height).toBe(30);
  });

  it('pads by four pixels by default', () => {
    const [region] = detectSensitiveRegions([line('anna@example.com', 50)]);
    expect(region?.rect).toEqual({ x: 0, y: 46, width: 164, height: HEIGHT + 8 });
  });

  it('shrinks a match inside a word to the share of the word it covers', () => {
    const [region] = detectSensitiveRegions([line('mail:a@b.io')], { padding: 0 });
    expect(region?.rect).toMatchObject({ x: 50, width: 60 });
  });
});

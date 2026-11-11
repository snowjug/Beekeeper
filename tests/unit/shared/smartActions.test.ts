import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SMART_ACTIONS,
  detectSmartActions,
  type SmartAction,
  type SmartActionType,
} from '@shared/smartActions';
import { parseSafeExternalUrl } from '@shared/url';
import { isValidEmailAddress } from '@shared/webLinks';

// Tuesday, 10 November 2026 (local time)
const NOW = new Date(2026, 10, 10, 16, 22);

const SCRIPT_URL = 'javascript:alert(1)'; // eslint-disable-line no-script-url

function detect(text: string): SmartAction[] {
  return detectSmartActions(text, { now: NOW });
}

function valuesOf(text: string, type: SmartActionType): string[] {
  return detect(text)
    .filter((action) => action.type === type)
    .map((action) => action.value);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('links', () => {
  it.each<[string, string, string[]]>([
    [
      'https url',
      'Open https://www.example.com/products now',
      ['https://www.example.com/products'],
    ],
    ['http stays http', 'old site http://example.com', ['http://example.com/']],
    ['www without scheme gets https', 'www.example.com', ['https://www.example.com/']],
    [
      'sentence period is not part of the link',
      'Visit www.example.com.',
      ['https://www.example.com/'],
    ],
    ['bare domain with a path', 'repo: github.com/user/repo', ['https://github.com/user/repo']],
    ['popular new TLD', 'chat at claude.ai today', ['https://claude.ai/']],
    ['multi-label country domain', 'sub.example.co.uk/page', ['https://sub.example.co.uk/page']],
    [
      'balanced parentheses stay, the closing one of the sentence goes',
      '(see https://en.wikipedia.org/wiki/Foo_(bar))',
      ['https://en.wikipedia.org/wiki/Foo_(bar)'],
    ],
    [
      'trailing comma and fragment',
      'https://example.com/a?b=c&d=e#frag, ok',
      ['https://example.com/a?b=c&d=e#frag'],
    ],
    ['surrounding quotes', 'go to "https://example.com/y"', ['https://example.com/y']],
    ['upper-case scheme and host', 'HTTPS://EXAMPLE.COM/Path', ['https://example.com/Path']],
    ['an all-caps bare domain', 'EXAMPLE.COM', ['https://example.com/']],
    ['pipe read for l', 'goog|e.com', ['https://google.com/']],
    ['pipes inside a link', 'https://examp|e.com/p|ay', ['https://example.com/play']],
    ['leading pipe is a table border', '|linkedin.com', ['https://linkedin.com/']],
    ['local server', 'http://localhost:3000/app', ['http://localhost:3000/app']],
    ['ip address with scheme', 'router http://192.168.1.1/admin', ['http://192.168.1.1/admin']],
    ['port on a bare domain', 'example.com:8080/x', ['https://example.com:8080/x']],
    [
      'wrapped after a slash',
      'Visit https://www.example.com/products/\nitem-42?ref=home for details',
      ['https://www.example.com/products/item-42?ref=home'],
    ],
    [
      'wrapped after a hyphen',
      'www.example.com/a-very-long-\npath-name',
      ['https://www.example.com/a-very-long-path-name'],
    ],
    [
      'wrapped before a query',
      'https://example.com/search\n?q=hello&lang=en',
      ['https://example.com/search?q=hello&lang=en'],
    ],
    ['invisible characters inside a link', 'www.exa\u200bmple.com', ['https://www.example.com/']],
    ['repeated link is reported once', 'www.a.com and again www.a.com', ['https://www.a.com/']],
  ])('finds a link: %s', (_name, text, expected) => {
    expect(valuesOf(text, 'url')).toEqual(expected);
  });

  it.each<[string, string]>([
    ['script scheme', SCRIPT_URL],
    ['file scheme', 'file:///C:/Windows/System32/calc.exe'],
    ['ftp', 'ftp://example.com/file.zip'],
    ['data url', 'data:text/html,<script>alert(1)</script>'],
    ['settings uri', 'ms-settings:network'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['embedded credentials', 'https://user:pass@example.com/'],
    ['file names', 'README.md main.py index.js setup.sh app.exe'],
    ['abbreviations', 'e.g. i.e. U.S.A. vs. etc.'],
    ['sentence run together', 'Example.com is nice, a mistake.It happens'],
    ['version numbers', 'v10.11.12 and 1.2.3 and 3.14'],
    ['ip address without scheme', 'router at 192.168.1.1'],
    ['truncated host', 'https://exa'],
    ['scheme alone', 'https://'],
    ['host that is not a domain', 'www.'],
  ])('ignores %s', (_name, text) => {
    expect(valuesOf(text, 'url')).toEqual([]);
  });

  it('does not join a link with the following sentence', () => {
    expect(valuesOf('See https://example.com/docs/\nfor more details', 'url')).toEqual([
      'https://example.com/docs/',
    ]);
  });

  it.each(['- second item', '1. second item', '* second item', '2) second item'])(
    'does not join a link with the list item %j below it',
    (item) => {
      expect(valuesOf(`https://example.com/docs/\n${item}`, 'url')).toEqual([
        'https://example.com/docs/',
      ]);
    },
  );

  it('keeps two links on separate lines apart', () => {
    expect(valuesOf('see https://a.com/x/\nhttps://b.com/y', 'url')).toEqual([
      'https://a.com/x/',
      'https://b.com/y',
    ]);
  });

  it('only ever produces http(s) links that pass parseSafeExternalUrl', () => {
    const nasty = [
      `${SCRIPT_URL} http://x.com/<script> https://ok.com/a`,
      'www.evil.com/\u0000\u0007x https://good.com',
      'https://exa\nmple.com/a http://[::1]/x ws://a.com wss://b.com',
      'https://example.com/' + 'a'.repeat(2100),
      'HtTp://MiXeD.CoM/Path?Q=1 //protocol-relative.com/x',
      'ｈｔｔｐｓ://fullwidth.com',
    ];
    for (const text of nasty) {
      for (const action of detect(text).filter((item) => item.type === 'url')) {
        expect(action.value).toMatch(/^https?:\/\//);
        expect(parseSafeExternalUrl(action.value)).not.toBeNull();
      }
    }
  });
});

describe('e-mail addresses', () => {
  it.each<[string, string, string[]]>([
    ['plain', 'Mail john.doe@example.com for help', ['john.doe@example.com']],
    ['address is lower-cased', 'SALES@Example.CO.UK', ['sales@example.co.uk']],
    ['plus tag and exclamation mark', 'alice+tag@example.io!', ['alice+tag@example.io']],
    ['sentence period', 'write to user@example.com.', ['user@example.com']],
    ['pipe read for l', 'john.|ee@example.com', ['john.lee@example.com']],
    ['mailto prefix', 'mailto:a@b.com', ['a@b.com']],
    ['angle brackets', 'Jane <jane@example.org>', ['jane@example.org']],
    ['two addresses', 'a@b.com, c@d.org', ['a@b.com', 'c@d.org']],
    ['same address in two cases', 'a@b.com A@B.COM', ['a@b.com']],
  ])('finds %s', (_name, text, expected) => {
    expect(valuesOf(text, 'email')).toEqual(expected);
  });

  it.each<[string, string]>([
    ['no top-level domain', 'john@localhost'],
    ['twitter handle', 'follow @handle today'],
    ['one-letter TLD', 'a@b.c'],
    ['digits in the TLD', 'x@y.c0m'],
    ['double dot', 'foo@bar..com'],
    ['space around the at sign', 'john @ example.com'],
    ['credentials of a link', 'https://user:pass@example.com/'],
    ['address inside a query string', 'https://example.com/?to=a@b.com'],
  ])('ignores %s', (_name, text) => {
    expect(valuesOf(text, 'email')).toEqual([]);
  });
});

describe('phone numbers', () => {
  it.each<[string, string, string]>([
    ['international with brackets', 'Call +1 (415) 555-0123', '+14155550123'],
    ['compact international', 'WhatsApp +14155550123', '+14155550123'],
    ['dashes', '415-555-0123', '4155550123'],
    ['brackets and spaces', '(415) 555 0123', '4155550123'],
    ['dots', '415.555.0123', '4155550123'],
    ['toll free with leading 1', '1-800-555-0199', '18005550199'],
    ['uk international', '+44 20 7946 0958', '+442079460958'],
    ['uk national', '020 7946 0958', '02079460958'],
    ['indian mobile', '98765 43210', '9876543210'],
    ['french national', '01 23 45 67 89', '0123456789'],
    ['seven digits with a label', 'Tel: 555-0199', '5550199'],
    ['bare digits with a label', 'Call 4155550123', '4155550123'],
  ])('finds %s', (_name, text, expected) => {
    expect(valuesOf(text, 'phone')).toEqual([expected]);
  });

  it.each<[string, string]>([
    ['iso date', '2026-11-12'],
    ['dotted date', '12.11.2026'],
    ['ip address', '192.168.100.200'],
    ['version', '10.0.19045.3693'],
    ['card number', '4111 1111 1111 1111'],
    ['thousands separators', '$1,234,567 and 1,234,567,890'],
    ['zip+4', '94105-1234'],
    ['isbn', '978-3-16-148410-0'],
    ['bare digits without a label', 'Order 4155550123 shipped'],
    ['list of years', '1999 2000 2001 2002'],
    ['seven digits without a label', 'see 555-0199'],
    ['price', '$4.99'],
    ['quarter', 'Q3 2026'],
  ])('ignores %s', (_name, text) => {
    expect(valuesOf(text, 'phone')).toEqual([]);
  });

  it('keeps the text as shown in display', () => {
    const [action] = detect('Call +1 (415) 555-0123 today');
    expect(action).toMatchObject({ type: 'phone', display: '+1 (415) 555-0123', label: 'Copy' });
  });
});

describe('dates', () => {
  it.each<[string, string, string]>([
    ['month day, year', 'Nov 12, 2026', '2026-11-12'],
    ['long month with ordinal', 'November 12th, 2026', '2026-11-12'],
    ['day month year', '12 Nov 2026', '2026-11-12'],
    ['ordinal "of" month', '12th of November 2026', '2026-11-12'],
    ['hyphenated', '12-Nov-2026', '2026-11-12'],
    ['weekday prefix', 'Thursday, November 12, 2026', '2026-11-12'],
    ['iso', '2026-11-12', '2026-11-12'],
    ['iso with slashes', '2026/11/12', '2026-11-12'],
    ['iso with dots', '2026.11.12', '2026-11-12'],
    ['iso date-time keeps the zone', '2026-11-12T15:30:00Z', '2026-11-12T15:30:00Z'],
    ['iso with offset', '2026-11-12T15:30+05:30', '2026-11-12T15:30+05:30'],
    ['iso with a space before the time', '2026-11-12 09:05', '2026-11-12T09:05'],
    ['12-hour time', 'Thu, Nov 12, 2026 at 3:30 PM', '2026-11-12T15:30'],
    ['noon is 12 pm', 'Nov 12, 2026 at 12pm', '2026-11-12T12:00'],
    ['midnight is 12 am', 'Nov 12, 2026 12:15 am', '2026-11-12T00:15'],
    ['24-hour time', '12 Nov 2026, 18:45', '2026-11-12T18:45'],
    ['ambiguous d/m is read as month/day', '12/11/2026', '2026-12-11'],
    ['unambiguous day first', '13/11/2026', '2026-11-13'],
    ['unambiguous month first', '11/13/2026', '2026-11-13'],
    ['two-digit year with slashes', '12/25/26', '2026-12-25'],
    ['year-less date later this year', 'Nov 12', '2026-11-12'],
    ['year-less date today', 'Nov 10', '2026-11-10'],
    ['year-less date that has passed', 'Nov 9', '2027-11-09'],
    ['year-less with ordinal', 'March 3rd', '2027-03-03'],
    ['leap day waits for the next leap year', 'Feb 29', '2028-02-29'],
    ['range keeps its start', 'Nov 12-15, 2026', '2026-11-12'],
    ['tomorrow', 'see you tomorrow', '2026-11-11'],
    ['tomorrow with a time', 'tomorrow at 9am', '2026-11-11T09:00'],
    ['day after tomorrow', 'the day after tomorrow', '2026-11-12'],
    ['tonight needs a time', 'tonight at 8:30 pm', '2026-11-10T20:30'],
    ['today with a time', 'today, 17:00', '2026-11-10T17:00'],
    ['this weekday is the coming one', 'this Friday', '2026-11-13'],
    ['this weekday that is today', 'this Tuesday', '2026-11-10'],
    ['on a weekday is strictly later', 'on Tuesday', '2026-11-17'],
    ['next weekday is in the following week', 'next Friday', '2026-11-20'],
    ['next Monday', 'next Monday', '2026-11-16'],
    ['next weekday with a time', 'next Friday at 3pm', '2026-11-20T15:00'],
    ['in days', 'in 3 days', '2026-11-13'],
    ['in weeks (number word)', 'in two weeks', '2026-11-24'],
    ['in a day', 'in a day', '2026-11-11'],
  ])('reads %s', (_name, text, expected) => {
    const dates = detect(text).filter((action) => action.type === 'date');
    expect(dates.map((action) => action.value)).toEqual([expected]);
    expect(dates[0]).toMatchObject({ isoDate: expected, label: 'Add reminder' });
  });

  it.each<[string, string]>([
    ['an impossible day', '2026-02-30'],
    ['a day the month does not have', '31/04/2026'],
    ['a month that does not exist', '2026-13-01'],
    ['a version number', '10.11.12'],
    ['a longer version number', 'v1.2.2026.4'],
    ['a quarter', 'Q3 2026'],
    ['a fraction', '3/4'],
    ['the modal verb', 'you may 5 times'],
    ['month and year only', 'November 2026'],
    ['"today" without a time', 'the news today'],
    ['"tomorrow" as part of a word', "tomorrow's world"],
    ['a bare weekday', 'Friday night'],
    ['an ip address', '192.168.1.1'],
    ['a year out of range', '1850-01-01'],
    ['a time on its own', 'at 3:30 PM'],
  ])('ignores %s', (_name, text) => {
    expect(valuesOf(text, 'date')).toEqual([]);
  });

  it('uses the real clock when no reference time is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 31, 23, 59));
    expect(detectSmartActions('tomorrow').map((action) => action.value)).toEqual(['2027-02-01']);
  });
});

describe('arithmetic', () => {
  it.each<[string, string, string]>([
    ['parentheses', '12 * (3 + 4)', '12 * (3 + 4)'],
    ['percent of', '15% of 2400', '15% of 2400'],
    ['percent word and currency', 'what is 20 percent of $85?', '20% of 85'],
    ['percent of with thousands', '20% of 1,250.50', '20% of 1250.50'],
    ['power', '2^10', '2^10'],
    ['division with spaces', '100 / 4', '100 / 4'],
    ['subtraction with spaces', '5 - 3', '5 - 3'],
    ['stops at the equals sign', '3.5 + 4.25 = 7.75', '3.5 + 4.25'],
    ['multiplication sign', 'what is 7 × 8?', '7 * 8'],
    ['division sign', '7 ÷ 2', '7 / 2'],
    ['unicode minus', '8 − 3', '8 - 3'],
    ['thousands separators', '1,000 + 2,500', '1000 + 2500'],
    ['unary minus', '-5 + 3', '-5 + 3'],
    ['percent operand', '100 + 15%', '100 + 15%'],
    ['no spaces', '(2+3)*4', '(2+3)*4'],
    ['inside a sentence', 'Total: 12 * (3 + 4) = 84', '12 * (3 + 4)'],
    ['years', '2026 - 1990', '2026 - 1990'],
  ])('calculates %s', (_name, text, expected) => {
    const math = detect(text).filter((action) => action.type === 'math');
    expect(math.map((action) => action.value)).toEqual([expected]);
    expect(math[0]).toMatchObject({ label: 'Calculate' });
  });

  it.each<[string, string]>([
    ['an ascending range', '3 - 5'],
    ['a page range', 'pages 10 - 20'],
    ['a page counter', '3 / 4'],
    ['a minus without spaces', '5-3'],
    ['a year range', '2019-2024'],
    ['a time range', '10:30 - 11:30'],
    ['a cell reference', 'A1+B2'],
    ['a variable', 'x^2 + 1'],
    ['a language name', 'C++'],
    ['hours with units', '3pm - 5pm'],
    ['a fraction', '1/2'],
    ['hours per week', '24/7'],
    ['a coordinate pair', '(1, 2)'],
    ['a dangling operator', '2 + '],
    ['a lone number', '(5)'],
    ['a double star', '2 ** 3'],
    ['a phone-like pair', '555 - 1234'],
    ['a plain number', '1,234,567'],
    ['an ip address', '10.0.0.1'],
    ['a date', '2026-11-12'],
    ['a price', '$4.99'],
    ['a decimal', '3.14159'],
  ])('ignores %s', (_name, text) => {
    expect(valuesOf(text, 'math')).toEqual([]);
  });
});

describe('result shape', () => {
  it('lists actions in reading order', () => {
    const text = 'Due 12/15/2026, mail a@b.com, call +1 415 555 0123, see www.example.com';
    expect(detect(text).map((action) => action.type)).toEqual(['date', 'email', 'phone', 'url']);
  });

  it('orders across lines', () => {
    const text = 'www.first.com\n2 + 2\nsecond@example.org\nNov 12, 2026';
    expect(detect(text).map((action) => action.type)).toEqual(['url', 'math', 'email', 'date']);
  });

  it('gives every action a stable id, label and display', () => {
    const actions = detect('Nov 12, 2026 a@b.com +1 415 555 0123 www.example.com 12 * 3 = 36');
    expect(actions.map((action) => action.label)).toEqual([
      'Add reminder',
      'Compose',
      'Copy',
      'Open',
      'Calculate',
    ]);
    for (const action of actions) {
      expect(action.id).toBe(`${action.type}:${action.value}`);
      expect(action.display.length).toBeGreaterThan(0);
      expect('isoDate' in action).toBe(action.type === 'date');
    }
    expect(new Set(actions.map((action) => action.id)).size).toBe(actions.length);
  });

  it('removes duplicates that were written differently', () => {
    expect(detect('12/11/2026 and 2026-12-11 and Dec 11, 2026')).toHaveLength(1);
  });

  it(`reports at most ${MAX_SMART_ACTIONS} actions`, () => {
    const text = Array.from({ length: 20 }, (_, index) => `user${index}@example.com`).join('\n');
    const actions = detect(text);
    expect(actions).toHaveLength(MAX_SMART_ACTIONS);
    expect(MAX_SMART_ACTIONS).toBe(8);
    expect(actions[0]?.value).toBe('user0@example.com');
  });

  it.each(['', '   ', '\n\n', 'just some words without anything special'])(
    'finds nothing in %j',
    (text) => {
      expect(detect(text)).toEqual([]);
    },
  );

  it('survives non-string input', () => {
    expect(detectSmartActions(undefined as unknown as string)).toEqual([]);
    expect(detectSmartActions(42 as unknown as string)).toEqual([]);
  });

  it('copes with OCR spacing noise', () => {
    const text = 'call\u00a0+1\u00a0415\u00a0555\u00a00123\r\nwww.exa\u00admple.com\r\n';
    expect(detect(text).map((action) => action.value)).toEqual([
      '+14155550123',
      'https://www.example.com/',
    ]);
  });

  it('handles very long text quickly', () => {
    const text = `${'lorem ipsum 12345 dolor-sit.amet, '.repeat(2000)}\nwww.example.com`;
    const started = performance.now();
    detect(text);
    detect('1 '.repeat(20_000));
    detect('a.'.repeat(20_000));
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it.each([
    ['digits and dashes', '1-'.repeat(10_000)],
    ['plus signs', '+'.repeat(20_000)],
    ['opening brackets', '('.repeat(20_000)],
    ['at signs', 'a@'.repeat(10_000)],
    ['long local part', `${'a'.repeat(20_000)}@`],
    ['dots', '.'.repeat(20_000)],
    ['zeros', '0'.repeat(20_000)],
    ['thousands separators', '1,'.repeat(10_000)],
    ['month names', 'Nov '.repeat(5000)],
    ['date separators', '12/'.repeat(6000)],
    ['scheme without host', 'http://'.repeat(2500)],
    ['www labels', `www.${'a.'.repeat(8000)}`],
    ['percent signs', '5%'.repeat(8000)],
    ['operators between numbers', '1 + '.repeat(5000)],
  ])('does not choke on %s', (_name, text) => {
    const started = performance.now();
    detect(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('only produces well-formed values for random noise', () => {
    const pool =
      ' \n\t0123456789.,:;/-+*^%()@|_#$&?=!"\'<>~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        .split('')
        .concat([
          'http://',
          'https://',
          'www.',
          '.com',
          'mailto:',
          'Nov ',
          'tomorrow',
          ' of ',
          '\u00d7',
          '\u2212',
        ]);
    let seed = 20_261_110;
    const next = (limit: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    for (let round = 0; round < 400; round += 1) {
      const text = Array.from({ length: 5 + next(120) }, () => pool[next(pool.length)]).join('');
      for (const action of detect(text)) {
        expect(action.id).toBe(`${action.type}:${action.value}`);
        if (action.type === 'url') {
          expect(parseSafeExternalUrl(action.value)).not.toBeNull();
          expect(action.value).toMatch(/^https?:\/\//);
        } else if (action.type === 'email') {
          expect(isValidEmailAddress(action.value)).toBe(true);
        } else if (action.type === 'phone') {
          expect(action.value).toMatch(/^\+?\d{7,15}$/);
        } else if (action.type === 'date') {
          expect(action.value).toMatch(
            /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/,
          );
        } else {
          expect(action.value).toMatch(/^[\d\s.+\-*/^%()]+$|^\d[\d.]*% of \d[\d.]*$/);
        }
      }
    }
  });
});

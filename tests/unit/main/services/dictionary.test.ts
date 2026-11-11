import { describe, expect, it, vi } from 'vitest';
import { createDictionaryService } from '@main/services/dictionary';
import { createFakeLogger } from '../commands/helpers';

const BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function service(respond: (url: string) => Response | Promise<Response>) {
  const fetchFn = vi.fn<typeof fetch>((input) => Promise.resolve(respond(urlOf(input))));
  const logger = createFakeLogger();
  return { dictionary: createDictionaryService({ fetch: fetchFn, logger }), fetchFn, logger };
}

const SERENDIPITY = [
  {
    word: 'serendipity',
    phonetic: '/ˌsɛ.ɹən.ˈdɪ.pɪ.ti/',
    phonetics: [{ text: '/ˌsɛ.ɹən.ˈdɪ.pɪ.ti/', audio: 'https://example.test/a.mp3' }],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          {
            definition:
              'A combination of events which have come together by chance to make a surprisingly good or wonderful outcome.',
            synonyms: [],
            antonyms: ["Murphy's law"],
          },
          {
            definition: 'An unsought, unintended, and/or unexpected, but fortunate, discovery.',
            synonyms: ['chance', 'luck'],
            antonyms: [],
          },
        ],
        synonyms: ['chance', 'luck'],
        antonyms: ["Murphy's law"],
      },
    ],
    license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' },
    sourceUrls: ['https://en.wiktionary.org/wiki/serendipity'],
  },
];

describe('dictionary service: lookups', () => {
  it('maps an entry onto the definition card data', async () => {
    const { dictionary, fetchFn } = service(() => json(SERENDIPITY));
    const result = await dictionary.define('serendipity');
    expect(fetchFn).toHaveBeenCalledWith(`${BASE}/serendipity`, expect.any(Object));
    expect(result).toEqual({
      kind: 'definition',
      word: 'serendipity',
      phonetic: '/ˌsɛ.ɹən.ˈdɪ.pɪ.ti/',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition:
                'A combination of events which have come together by chance to make a surprisingly good or wonderful outcome.',
            },
            { definition: 'An unsought, unintended, and/or unexpected, but fortunate, discovery.' },
          ],
          synonyms: ['chance', 'luck'],
        },
      ],
      sourceUrl: 'https://en.wiktionary.org/wiki/serendipity',
    });
  });

  it('trims, lower-cases and encodes the word', async () => {
    const { dictionary, fetchFn } = service(() => json(SERENDIPITY));
    await dictionary.define('  Ice Cream ');
    await dictionary.define("o'clock");
    expect(fetchFn.mock.calls.map(([url]) => urlOf(url))).toEqual([
      `${BASE}/ice%20cream`,
      `${BASE}/o'clock`,
    ]);
  });

  it('does not call out for an empty word', async () => {
    const { dictionary, fetchFn } = service(() => json([]));
    await expect(dictionary.define('   ')).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats a 404 as an unknown word', async () => {
    const { dictionary } = service(() =>
      json({ title: 'No Definitions Found', message: 'Sorry pal' }, 404),
    );
    await expect(dictionary.define('asdfqwer')).resolves.toBeNull();
  });

  it('treats an entry without usable meanings as an unknown word', async () => {
    const entry = {
      word: 'blank',
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: '   ' }] }],
    };
    const { dictionary } = service(() => json([entry]));
    await expect(dictionary.define('blank')).resolves.toBeNull();
    const none = service(() => json([]));
    await expect(none.dictionary.define('blank')).resolves.toBeNull();
  });
});

describe('dictionary service: mapping details', () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    word: 'run',
    meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To move quickly.' }] }],
    ...overrides,
  });

  it('keeps three definitions per meaning and five synonyms', async () => {
    const meaning = {
      partOfSpeech: 'noun',
      definitions: ['one', 'two', 'three', 'four'].map((text, index) => ({
        definition: `Definition ${text}`,
        synonyms: [`syn-${index}a`, `syn-${index}b`],
      })),
      synonyms: ['syn-0a', 'extra'],
    };
    const { dictionary } = service(() => json([entry({ meanings: [meaning] })]));
    const result = await dictionary.define('run');
    expect(result?.meanings[0]?.definitions.map((item) => item.definition)).toEqual([
      'Definition one',
      'Definition two',
      'Definition three',
    ]);
    expect(result?.meanings[0]?.synonyms).toEqual([
      'syn-0a',
      'extra',
      'syn-0b',
      'syn-1a',
      'syn-1b',
    ]);
  });

  it('merges the meanings of several entries by part of speech', async () => {
    const entries = [
      entry({
        meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To move quickly.' }] }],
      }),
      entry({
        meanings: [
          { partOfSpeech: 'noun', definitions: [{ definition: 'An act of running.' }] },
          { partOfSpeech: 'verb', definitions: [{ definition: 'To operate.' }] },
        ],
      }),
    ];
    const { dictionary } = service(() => json(entries));
    const result = await dictionary.define('run');
    expect(result?.meanings.map((meaning) => meaning.partOfSpeech)).toEqual(['verb', 'noun']);
    expect(result?.meanings[0]?.definitions).toEqual([
      { definition: 'To move quickly.' },
      { definition: 'To operate.' },
    ]);
  });

  it('keeps examples only when there is something to show', async () => {
    const meaning = {
      partOfSpeech: 'noun',
      definitions: [
        { definition: 'With example.', example: '  A sentence.  ' },
        { definition: 'Blank example.', example: '   ' },
        { definition: 'Null example.', example: null },
      ],
    };
    const { dictionary } = service(() => json([entry({ meanings: [meaning] })]));
    const result = await dictionary.define('run');
    expect(result?.meanings[0]?.definitions).toEqual([
      { definition: 'With example.', example: 'A sentence.' },
      { definition: 'Blank example.' },
      { definition: 'Null example.' },
    ]);
  });

  it('skips blank definitions and meanings without any', async () => {
    const meanings = [
      { partOfSpeech: 'noun', definitions: [{ definition: '  ' }] },
      { partOfSpeech: 'verb', definitions: [{ definition: ' To go. ' }, { definition: '' }] },
    ];
    const { dictionary } = service(() => json([entry({ meanings })]));
    const result = await dictionary.define('run');
    expect(result?.meanings).toEqual([
      { partOfSpeech: 'verb', definitions: [{ definition: 'To go.' }] },
    ]);
  });

  it('falls back to the phonetics list and tolerates nulls', async () => {
    const { dictionary } = service(() =>
      json([
        entry({
          phonetic: null,
          phonetics: [{ text: null }, { text: '/rʌn/' }],
          sourceUrls: null,
          meanings: [
            {
              partOfSpeech: 'verb',
              synonyms: null,
              definitions: [{ definition: 'To move.', synonyms: null }],
            },
          ],
        }),
      ]),
    );
    const result = await dictionary.define('run');
    expect(result).toEqual({
      kind: 'definition',
      word: 'run',
      phonetic: '/rʌn/',
      meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To move.' }] }],
    });
  });

  it('only links to web pages', async () => {
    const { dictionary } = service(() =>
      json([
        entry({
          sourceUrls: [
            'data:text/html,<b>run</b>',
            'file:///c:/secret',
            'https://en.wiktionary.org/wiki/run',
          ],
        }),
      ]),
    );
    expect((await dictionary.define('run'))?.sourceUrl).toBe('https://en.wiktionary.org/wiki/run');
    const unsafe = service(() => json([entry({ sourceUrls: ['ftp://example.test/run'] })]));
    expect((await unsafe.dictionary.define('run'))?.sourceUrl).toBeUndefined();
  });
});

describe('dictionary service: failures', () => {
  it('throws a clear error when the network is down', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    const logger = createFakeLogger();
    const dictionary = createDictionaryService({ fetch: fetchFn, logger });
    await expect(dictionary.define('cat')).rejects.toThrow("Couldn't reach the dictionary service");
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws on server errors', async () => {
    const { dictionary } = service(() => json({}, 500));
    await expect(dictionary.define('cat')).rejects.toThrow("Couldn't reach the dictionary service");
  });

  it('throws on responses it cannot read', async () => {
    const html = service(() => new Response('<html>'));
    await expect(html.dictionary.define('cat')).rejects.toThrow(
      "Couldn't reach the dictionary service",
    );
    const wrongShape = service(() => json({ word: 'cat' }));
    await expect(wrongShape.dictionary.define('cat')).rejects.toThrow('unexpected response');
    expect(wrongShape.logger.warn).toHaveBeenCalled();
    const noMeanings = service(() => json([{ word: 'cat' }]));
    await expect(noMeanings.dictionary.define('cat')).rejects.toThrow('unexpected response');
  });
});

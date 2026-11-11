import { describe, expect, it } from 'vitest';
import type { DefinitionCard, StatusCard } from '@shared/cards';
import { dictionaryCommand } from '@main/commands/info/define';
import type { DictionaryService } from '@main/commands/types';
import { createFakeLogger, createFakeServices, matchOf, runContext } from '../helpers';

describe('define: phrases', () => {
  it.each([
    ['define serendipity', 'serendipity'],
    ['what does ephemeral mean', 'ephemeral'],
    ['definition of quixotic', 'quixotic'],
    ["what's the meaning of word", 'word'],
    ['meaning of resilient', 'resilient'],
    ['dictionary lookup for x', 'x'],
    ['define the word serendipity', 'serendipity'],
    ['what does the word ephemeral mean', 'ephemeral'],
    ['whats the definition of cat', 'cat'],
    ['what is the definition of the word love', 'love'],
    ['what is the meaning of life', 'life'],
    ['what does carpe diem mean', 'carpe diem'],
    ['definition of ice cream', 'ice cream'],
    ['dictionary serendipity', 'serendipity'],
    ['dictionary definition of ephemeral', 'ephemeral'],
    ['look up serendipity in the dictionary', 'serendipity'],
    ['look up the meaning of ephemeral', 'ephemeral'],
    ["what's serendipity mean", 'serendipity'],
    ['tell me the meaning of resilient', 'resilient'],
    ['give me the definition of cat', 'cat'],
    ['Hey Beekeeper, please define resilient', 'resilient'],
    ['defining serendipity', 'serendipity'],
  ])('%s', (text, word) => {
    expect(matchOf(dictionaryCommand, text)).toEqual({ slots: { word }, score: 0.95 });
  });

  it.each([
    ['defin serendipity', 'serendipity'],
    ['what dose ephemeral mean', 'ephemeral'],
    ['whats the definiton of cat', 'cat'],
    ['meanin of life', 'life'],
    ['dictionnary lookup for cat', 'cat'],
    ['what does ephemeral mena', 'ephemeral'],
  ])('repairs the typo in %s', (text, word) => {
    expect(matchOf(dictionaryCommand, text)).toEqual({ slots: { word }, score: 0.85 });
  });

  it.each([
    'define',
    'what does that mean',
    'what does it mean',
    'what do you mean',
    'what does 2+2 mean',
    'what does a b c d mean',
    'definition of that',
    'meaning of this',
    'what is love',
    'weather in paris',
    'search for the meaning',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(dictionaryCommand, text)).toBeNull();
  });

  it('refuses absurdly long words', () => {
    expect(matchOf(dictionaryCommand, `define ${'a'.repeat(50)}`)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(dictionaryCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of dictionaryCommand.examples) {
      expect(matchOf(dictionaryCommand, example), example).not.toBeNull();
    }
  });
});

describe('define: answers', () => {
  type Definition = NonNullable<Awaited<ReturnType<DictionaryService['define']>>>;

  const definition = (overrides: Partial<Definition> = {}): Definition => ({
    kind: 'definition',
    word: 'serendipity',
    phonetic: '/ˌsɛɹənˈdɪpɪti/',
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'A combination of events which have come together by chance.' },
          { definition: 'An unexpected discovery.', example: 'A happy accident.' },
        ],
        synonyms: ['chance', 'luck'],
      },
      { partOfSpeech: 'verb', definitions: [{ definition: 'To find by luck.' }] },
      { partOfSpeech: 'adjective', definitions: [{ definition: 'Lucky.' }] },
      { partOfSpeech: 'adverb', definitions: [{ definition: 'Luckily.' }] },
    ],
    sourceUrl: 'https://en.wiktionary.org/wiki/serendipity',
    ...overrides,
  });

  const run = async (
    result: Definition | null | Error,
    word = 'serendipity',
    logger = createFakeLogger(),
  ) => {
    const services = createFakeServices();
    const define = (): ReturnType<DictionaryService['define']> =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    services.dictionary = { define };
    const output = await dictionaryCommand.run({ word }, runContext({ services, logger }));
    return { output, logger };
  };

  it('shows the top meanings and reads the first definition', async () => {
    const { output } = await run(definition());
    const card = output.cards[0] as DefinitionCard;
    expect(card).toMatchObject({
      kind: 'definition',
      id: 'id-1',
      word: 'serendipity',
      phonetic: '/ˌsɛɹənˈdɪpɪti/',
      openUrl: 'https://en.wiktionary.org/wiki/serendipity',
      sourceUrl: 'https://en.wiktionary.org/wiki/serendipity',
    });
    expect(card.meanings.map((meaning) => meaning.partOfSpeech)).toEqual([
      'noun',
      'verb',
      'adjective',
    ]);
    expect(card.copyText).toBe(
      [
        'serendipity /ˌsɛɹənˈdɪpɪti/',
        'noun: A combination of events which have come together by chance.',
        'verb: To find by luck.',
        'adjective: Lucky.',
      ].join('\n'),
    );
    expect(output.speech).toBe(
      'serendipity, noun. A combination of events which have come together by chance.',
    );
  });

  it('copes with entries without phonetics or a source', async () => {
    const { output } = await run(
      definition({
        phonetic: undefined,
        sourceUrl: undefined,
        meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To find by luck.' }] }],
      }),
    );
    const card = output.cards[0] as DefinitionCard;
    expect(card.copyText).toBe('serendipity\nverb: To find by luck.');
    expect(card.openUrl).toBeUndefined();
  });

  it('shortens very long definitions for speech', async () => {
    const long = 'word '.repeat(100).trim();
    const { output } = await run(
      definition({ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: long }] }] }),
    );
    expect(output.speech?.endsWith('…')).toBe(true);
    expect(output.speech?.length).toBeLessThan(320);
  });

  it('stays silent when an entry has nothing to read', async () => {
    const { output } = await run(definition({ meanings: [] }));
    expect(output.speech).toBeUndefined();
    expect(output.cards).toHaveLength(1);
  });

  it('says so when the word is unknown', async () => {
    const { output } = await run(null, 'blorptastic');
    const card = output.cards[0] as StatusCard;
    expect(card).toMatchObject({
      tone: 'warning',
      icon: 'book',
      title: 'I couldn\'t find "blorptastic"',
    });
    expect(output.speech).toBe("I couldn't find a definition for blorptastic.");
  });

  it('shows a friendly error when the dictionary cannot be reached', async () => {
    const { output, logger } = await run(new Error('offline'));
    const card = output.cards[0] as StatusCard;
    expect(card).toMatchObject({ tone: 'error', title: "I couldn't reach the dictionary" });
    expect(output.speech).toBe(
      "I couldn't reach the dictionary. Check your connection and try again.",
    );
    expect(logger.warn).toHaveBeenCalled();
  });
});

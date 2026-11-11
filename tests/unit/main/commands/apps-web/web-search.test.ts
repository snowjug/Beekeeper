import { describe, expect, it } from 'vitest';
import { webSearchCommand } from '@main/commands/apps-web/web-search';
import { createHarness, match, runCommand, scoreOf, slotsOf } from './support';

describe('web-search matching', () => {
  it.each(webSearchCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(webSearchCommand, example)).not.toBeNull();
  });

  it.each([
    ['search for cats', 'bing', 'cats'],
    ['google best pizza', 'google', 'best pizza'],
    ['bing weather paris', 'bing', 'weather paris'],
    ['search the web for rust tutorials', 'bing', 'rust tutorials'],
    ['look up electron docs', 'bing', 'electron docs'],
    ['search bing for x', 'bing', 'x'],
    ['search google for typescript generics', 'google', 'typescript generics'],
    ['google search for cats', 'google', 'cats'],
    ['google for cats', 'google', 'cats'],
    ['bing how tall is mount everest', 'bing', 'how tall is mount everest'],
    ['search online for cheap flights', 'bing', 'cheap flights'],
    ['search the internet for cat memes', 'bing', 'cat memes'],
    ['web search for node versions', 'bing', 'node versions'],
    ['do a web search for rust', 'bing', 'rust'],
    ['lookup electron docs', 'bing', 'electron docs'],
    ['search about the moon landing', 'bing', 'the moon landing'],
    ['search for cats on google', 'google', 'cats'],
    ['search for cats on bing', 'bing', 'cats'],
    ['find cats on google', 'google', 'cats'],
    ['look up rust on the web', 'bing', 'rust'],
    ['look up rust online', 'bing', 'rust'],
    ['search cats', 'bing', 'cats'],
    ['Hey Beekeeper, please google Best Pizza', 'google', 'best pizza'],
  ])('"%s" searches %s for "%s"', (text, engine, query) => {
    expect(slotsOf(webSearchCommand, text)).toEqual({ engine, query });
  });

  it('is surest when the engine is named', () => {
    expect(scoreOf(webSearchCommand, 'google cats')).toBe(0.95);
    expect(scoreOf(webSearchCommand, 'search bing for cats')).toBe(0.95);
    expect(scoreOf(webSearchCommand, 'search for cats')).toBe(0.9);
    expect(scoreOf(webSearchCommand, 'look up cats')).toBe(0.85);
  });

  it('forgives a typo in the verb with less confidence', () => {
    expect(slotsOf(webSearchCommand, 'serach for cats')).toEqual({ engine: 'bing', query: 'cats' });
    expect(scoreOf(webSearchCommand, 'serach for cats')).toBe(0.8);
  });

  it('leaves definitions to the define command', () => {
    expect(scoreOf(webSearchCommand, 'look up the meaning of serendipity')).toBe(0.55);
    expect(scoreOf(webSearchCommand, 'search for the definition of serendipity')).toBe(0.55);
  });

  it.each([
    'search',
    'search for',
    'google',
    'bing',
    'look up',
    'search the web',
    'search online',
    'search bing',
    'what is the weather',
    'define serendipity',
    'what time is it',
    'find my keys',
    'find the file',
    'search youtube for cats',
    'search on youtube for cats',
    'search for cats on youtube',
    'look up lofi on youtube',
    'search this',
    'search it',
    'search my screen',
    'search my notes for milk',
    'search notes',
    'search the history',
    'circle to search',
    'research the topic',
    'play some jazz',
    'open google.com',
  ])('does not claim "%s"', (text) => {
    expect(match(webSearchCommand, text)).toBeNull();
  });
});

describe('web-search run', () => {
  it('opens the engine in the browser and shows a search card', async () => {
    const harness = createHarness();
    const result = await runCommand(
      webSearchCommand,
      { engine: 'bing', query: 'rust tutorials' },
      harness,
    );

    const url = 'https://www.bing.com/search?q=rust%20tutorials';
    expect(harness.ui.openExternal).toHaveBeenCalledWith(url);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      kind: 'search',
      engine: 'bing',
      query: 'rust tutorials',
      url,
      openUrl: url,
      copyText: 'rust tutorials',
    });
    expect(result.speech).toBe('Searching Bing for rust tutorials.');
    expect(result.autoCloseMs).toBe(3000);
  });

  it('encodes special characters and uses Google when asked', async () => {
    const harness = createHarness();
    await runCommand(webSearchCommand, { engine: 'google', query: 'c++ & "rust"?' }, harness);
    expect(harness.ui.openExternal).toHaveBeenCalledWith(
      'https://www.google.com/search?q=c%2B%2B%20%26%20%22rust%22%3F',
    );
  });

  it('shortens long queries when speaking', async () => {
    const harness = createHarness();
    const query = 'a'.repeat(120);
    const result = await runCommand(webSearchCommand, { engine: 'bing', query }, harness);
    expect(result.speech).toBe(`Searching Bing for ${'a'.repeat(80)}….`);
  });

  it.each([
    ['returns false', false],
    ['throws', () => Promise.reject(new Error('no browser'))],
  ] as const)('keeps the card and explains when the browser %s', async (_label, openExternal) => {
    const harness = createHarness({ openExternal });
    const result = await runCommand(webSearchCommand, { engine: 'google', query: 'cats' }, harness);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({ kind: 'search', engine: 'google' });
    expect(result.cards[1]).toMatchObject({ kind: 'status', tone: 'error' });
    expect(result.speech).toBe("Sorry, I couldn't open your browser.");
  });
});

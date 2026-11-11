import { describe, expect, it } from 'vitest';
import { youtubeCommand } from '@main/commands/apps-web/youtube';
import { createHarness, match, runCommand, scoreOf, slotsOf } from './support';

describe('youtube matching', () => {
  it.each(youtubeCommand.examples)('matches its own example "%s"', (example) => {
    expect(match(youtubeCommand, example)).not.toBeNull();
  });

  it.each([
    ['play despacito on youtube', 'despacito'],
    ['play some jazz on youtube', 'jazz'],
    ['youtube lofi beats', 'lofi beats'],
    ['search youtube for cats', 'cats'],
    ['search on youtube for cats', 'cats'],
    ['search for cats on youtube', 'cats'],
    ['look up lofi on youtube', 'lofi'],
    ['find speedruns on youtube', 'speedruns'],
    ['youtube search cats', 'cats'],
    ['youtube for cats', 'cats'],
    ['watch the best goals of 2024 on youtube', 'best goals of 2024'],
    ['put on relaxing music on youtube', 'relaxing music'],
    ['show me cat videos on youtube', 'cat videos'],
    ['stream the news from youtube', 'news'],
    ['Hey Beekeeper, play Despacito on YouTube please', 'despacito'],
  ])('"%s" searches YouTube for "%s"', (text, query) => {
    expect(slotsOf(youtubeCommand, text)).toEqual({ query });
    expect(scoreOf(youtubeCommand, text)).toBe(0.95);
  });

  it.each([
    'youtube',
    'open youtube',
    'play despacito',
    'play some music',
    'search for cats',
    'play on youtube',
    'search youtube',
    'what is youtube',
    'watch tv',
  ])('does not claim "%s"', (text) => {
    expect(match(youtubeCommand, text)).toBeNull();
  });
});

describe('youtube run', () => {
  it('opens the YouTube results page', async () => {
    const harness = createHarness();
    const result = await runCommand(youtubeCommand, { query: 'lofi beats' }, harness);

    const url = 'https://www.youtube.com/results?search_query=lofi%20beats';
    expect(harness.ui.openExternal).toHaveBeenCalledWith(url);
    expect(result.cards[0]).toMatchObject({
      kind: 'search',
      engine: 'youtube',
      query: 'lofi beats',
      url,
      openUrl: url,
    });
    expect(result.speech).toBe('Searching YouTube for lofi beats.');
  });

  it('explains a browser that cannot be opened', async () => {
    const harness = createHarness({ openExternal: false });
    const result = await runCommand(youtubeCommand, { query: 'cats' }, harness);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[1]).toMatchObject({ tone: 'error', title: "I couldn't open your browser" });
  });

  it('survives a browser that throws', async () => {
    const harness = createHarness({ openExternal: () => Promise.reject(new Error('boom')) });
    const result = await runCommand(youtubeCommand, { query: 'cats' }, harness);
    expect(result.cards[1]).toMatchObject({ tone: 'error' });
  });
});

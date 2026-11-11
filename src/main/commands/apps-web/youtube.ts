import type { SearchCard } from '@shared/cards';
import { defineCommand } from '../types';
import { browserFailure, spoken, tidyQuery } from './cards';

export interface YouTubeSlots {
  query: string;
}

const SEARCH_URL = 'https://www.youtube.com/results?search_query=';
const SITE = '(?:on|in|from|via|using|at)\\s+youtube';

/** Every phrase that names YouTube explicitly; the capture group is the search text. */
const PATTERNS: readonly RegExp[] = [
  // "play despacito on youtube", "play some jazz on youtube", "watch cat videos on youtube"
  new RegExp(`^(?:play|watch|put on|stream|show me|show)\\s+(.+?)\\s+${SITE}$`),
  // "search for cats on youtube", "look up lofi on youtube", "find speedruns on youtube"
  new RegExp(`^(?:search|find|look\\s?up)\\s+(?:for\\s+)?(.+?)\\s+${SITE}$`),
  // "search youtube for cats", "search on youtube for cats", "find on youtube cats"
  /^(?:search|find|look\s?up)\s+(?:on\s+|in\s+)?youtube(?:\s+for)?\s+(.+)$/,
  // "youtube lofi beats", "youtube search cats", "youtube for cats"
  /^youtube\s+(?:search\s+)?(?:for\s+)?(.+)$/,
];
const FILLER = /^(?:some|a|an|the|any)\s+/;

export const youtubeCommand = defineCommand<YouTubeSlots>({
  id: 'youtube',
  number: 4,
  group: 'apps-web',
  title: 'Play on YouTube',
  icon: 'youtube',
  examples: [
    'Play despacito on YouTube',
    'YouTube lofi beats',
    'Play some jazz on YouTube',
    'Search YouTube for cats',
    'Watch speedruns on YouTube',
  ],

  match(input) {
    for (const pattern of PATTERNS) {
      const found = pattern.exec(input.text)?.[1];
      if (found === undefined) continue;
      const query = tidyQuery(found.replace(FILLER, ''));
      if (query !== '') return { slots: { query }, score: 0.95 };
    }
    return null;
  },

  async run({ query }, ctx) {
    const url = `${SEARCH_URL}${encodeURIComponent(query)}`;
    let opened = false;
    try {
      opened = await ctx.services.ui.openExternal(url);
    } catch (error) {
      ctx.logger.warn('Could not open the YouTube search', error);
    }

    const card: SearchCard = {
      kind: 'search',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      engine: 'youtube',
      query,
      url,
      openUrl: url,
      copyText: query,
    };
    if (!opened) {
      const failure = browserFailure(ctx);
      return { cards: [card, ...failure.cards], speech: failure.speech };
    }
    return {
      cards: [card],
      speech: `Searching YouTube for ${spoken(query)}.`,
      autoCloseMs: 3000,
    };
  },
});

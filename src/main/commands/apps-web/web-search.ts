import type { SearchCard } from '@shared/cards';
import { matchLeadingVerb } from '../text';
import { defineCommand } from '../types';
import { browserFailure, spoken, tidyQuery } from './cards';

export type SearchEngine = 'google' | 'bing';

export interface WebSearchSlots {
  engine: SearchEngine;
  query: string;
}

const ENGINES: Readonly<Record<SearchEngine, { label: string; url: string }>> = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
};
const DEFAULT_ENGINE: SearchEngine = 'bing';

/** "google best pizza", "bing weather paris", "google search for cats". */
const ENGINE_FIRST = /^(google|bing)\s+(?:search\s+)?(?:for\s+|about\s+)?(.+)$/;
/** "search for cats", "look up electron docs", "search the web for x", "find x on google". */
const VERB_FIRST =
  /^(?:(?:do|run|perform)\s+a\s+)?(?:(?:web|internet|online)\s+)?(search|look\s?up|find)\s+(.+)$/;
const LEADING_ENGINE =
  /^(?:(?:on|in|using|with|via|through)\s+)?(?:the\s+)?(web|internet|net|online|google|bing|youtube)(?:\s+(?:for|about))?\s+(.+)$/;
const ONLY_AN_ENGINE = /^(?:the\s+)?(?:web|internet|net|online|google|bing)$/;
const TRAILING_ENGINE =
  /^(.+?)\s+(?:(?:on|in|using|with|via|through)\s+(?:the\s+)?(web|internet|net|google|bing|youtube)|online)$/;
/** Searching these is a job for other commands (notes, screen search, definitions). */
const NOT_A_WEB_QUERY =
  /^(?:for|about|up|the|a|an|me|something|anything|this|that|it|these|those|the screen|my screen|screen|the image|this image|what'?s on (?:my )?screen)$|^(?:(?:my|the)\s+)?(?:notes?|reminders?|timers?|alarms?|history)(?:\s|$)/;
const DEFINITION_QUERY = /^(?:the\s+)?(?:meaning|definitions?)\s+of\b/;

interface ParsedSearch {
  engine: SearchEngine;
  query: string;
  score: number;
}

function asEngine(word: string | undefined): SearchEngine | null {
  return word === 'google' || word === 'bing' ? word : null;
}

function parseSearch(text: string): ParsedSearch | null {
  const first = ENGINE_FIRST.exec(text);
  if (first !== null) {
    return finish(asEngine(first[1]), first[2] ?? '', 0.95);
  }

  const verbMatch = VERB_FIRST.exec(text);
  if (verbMatch === null) return null;
  const verb = verbMatch[1] ?? '';
  let rest = verbMatch[2] ?? '';
  let engine: SearchEngine | null = null;
  let explicit = false;

  const leading = LEADING_ENGINE.exec(rest);
  if (leading !== null) {
    if (leading[1] === 'youtube') return null;
    engine = asEngine(leading[1]);
    explicit = true;
    rest = leading[2] ?? '';
  } else if (ONLY_AN_ENGINE.test(rest)) {
    return null;
  }

  const trailing = TRAILING_ENGINE.exec(rest);
  if (trailing !== null) {
    if (trailing[2] === 'youtube') return null;
    engine ??= asEngine(trailing[2]);
    explicit = true;
    rest = trailing[1] ?? '';
  }

  if (verb === 'find' && !explicit) return null;
  const score = explicit ? 0.95 : verb === 'search' ? 0.9 : 0.85;
  return finish(engine, rest.replace(/^(?:for|about|up)\s+/, ''), score);
}

function finish(engine: SearchEngine | null, rawQuery: string, score: number): ParsedSearch | null {
  const query = tidyQuery(rawQuery);
  if (query === '' || NOT_A_WEB_QUERY.test(query)) return null;
  return {
    engine: engine ?? DEFAULT_ENGINE,
    query,
    // Another command (define) is the better home for "look up the meaning of ...".
    score: DEFINITION_QUERY.test(query) ? Math.min(score, 0.55) : score,
  };
}

export const webSearchCommand = defineCommand<WebSearchSlots>({
  id: 'web-search',
  number: 3,
  group: 'apps-web',
  title: 'Search the web',
  icon: 'search',
  examples: [
    'Search for cats',
    'Google best pizza',
    'Bing weather in Paris',
    'Search the web for rust tutorials',
    'Look up Electron docs',
    'Search Bing for TypeScript generics',
  ],

  match(input) {
    let parsed = parseSearch(input.text);
    if (parsed === null) {
      // "serach for cats": forgive a typo in the verb, with less confidence.
      const fixed = matchLeadingVerb(input.text, ['search']);
      const retry =
        fixed !== null && !fixed.exact ? parseSearch(`search ${fixed.rest}`.trim()) : null;
      if (retry !== null) parsed = { ...retry, score: Math.min(retry.score, 0.8) };
    }
    return parsed === null
      ? null
      : { slots: { engine: parsed.engine, query: parsed.query }, score: parsed.score };
  },

  async run({ engine, query }, ctx) {
    const { label, url: base } = ENGINES[engine];
    const url = `${base}${encodeURIComponent(query)}`;
    let opened = false;
    try {
      opened = await ctx.services.ui.openExternal(url);
    } catch (error) {
      ctx.logger.warn(`Could not open the ${label} search`, error);
    }

    const card: SearchCard = {
      kind: 'search',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      engine,
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
      speech: `Searching ${label} for ${spoken(query)}.`,
      autoCloseMs: 3000,
    };
  },
});

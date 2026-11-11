import type { CommandResult, SearchCard, StatusCard } from '@shared/cards';
import type { RunContext } from './types';

const SEARCH_URL = 'https://www.bing.com/search?q=';
/** Keeps the encoded URL well below the 2048 character limit, even for non-Latin text. */
const MAX_QUERY_LENGTH = 200;
const MAX_SPOKEN_LENGTH = 80;

function statusResult(
  ctx: RunContext,
  tone: StatusCard['tone'],
  title: string,
  detail: string,
): CommandResult {
  const card: StatusCard = {
    kind: 'status',
    id: ctx.newId(),
    createdAt: ctx.now.getTime(),
    tone,
    icon: 'search',
    title,
    detail,
  };
  return { cards: [card], speech: `${title}. ${detail}` };
}

/**
 * The non-AI branch of the fallback (spec 4.4 item 29): anything no command understood is
 * searched on the web in the default browser.
 */
export async function webSearchFallback(query: string, ctx: RunContext): Promise<CommandResult> {
  const text = query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
  if (text.length === 0) {
    return statusResult(ctx, 'warning', "I didn't catch that", 'Try saying or typing it again.');
  }

  const url = `${SEARCH_URL}${encodeURIComponent(text)}`;
  let opened = false;
  try {
    opened = await ctx.services.ui.openExternal(url);
  } catch (error) {
    ctx.logger.warn('Could not open the web search', error);
  }
  if (!opened) {
    return statusResult(
      ctx,
      'error',
      "I couldn't open your browser",
      'Check your default browser and try again.',
    );
  }

  const spoken = text.length > MAX_SPOKEN_LENGTH ? `${text.slice(0, MAX_SPOKEN_LENGTH)}…` : text;
  const card: SearchCard = {
    kind: 'search',
    id: ctx.newId(),
    createdAt: ctx.now.getTime(),
    engine: 'web',
    query: text,
    url,
    openUrl: url,
  };
  return { cards: [card], speech: `Searching the web for ${spoken}`, autoCloseMs: 3000 };
}

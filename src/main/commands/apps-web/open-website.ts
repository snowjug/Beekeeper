import { matchLeadingVerb } from '../text';
import { defineCommand } from '../types';
import { browserFailure, statusCard } from './cards';
import { parseWebsite, restoreCase } from './domain';

export interface OpenWebsiteSlots {
  url: string;
  host: string;
}

const WEB_VERBS = [
  'open',
  'go to',
  'visit',
  'navigate to',
  'browse to',
  'browse',
  'take me to',
  'head to',
  'load',
  'launch',
  'show me',
];
/** "open the website bbc.co.uk", "go to the page example.org". */
const DESCRIPTOR = /^(?:(?:the|a)\s+)?(?:web\s?site|site|web\s?page|page|url|link|address)\s+/;

export const openWebsiteCommand = defineCommand<OpenWebsiteSlots>({
  id: 'open-website',
  number: 5,
  group: 'apps-web',
  title: 'Open a website',
  icon: 'web',
  examples: [
    'Open github.com',
    'Go to example.org',
    'Visit https://news.ycombinator.com',
    'Open the website bbc.co.uk',
    'Navigate to openai.com/research',
  ],

  match(input) {
    const verb = matchLeadingVerb(input.text, WEB_VERBS);
    // A lone address ("github.com") is opened too, but with less certainty.
    const token = verb === null ? input.text : verb.rest.replace(DESCRIPTOR, '');
    if (token.includes(' ')) return null;

    // Paths and queries are case-sensitive: take the address from the original text.
    const website = parseWebsite(restoreCase(input.raw, token));
    if (website === null) return null;
    const explicitScheme = /^https?:\/\//.test(token);
    let score = verb === null ? (explicitScheme ? 0.9 : 0.72) : explicitScheme ? 0.98 : 0.96;
    if (verb !== null && !verb.exact) score = 0.85;
    return { slots: { url: website.url, host: website.host }, score };
  },

  async run({ url, host }, ctx) {
    let opened = false;
    try {
      opened = await ctx.services.ui.openExternal(url);
    } catch (error) {
      ctx.logger.warn(`Could not open ${url}`, error);
    }
    if (!opened) return browserFailure(ctx);
    const card = statusCard(ctx, {
      tone: 'success',
      icon: 'web',
      title: `Opening ${host}`,
      detail: url,
      copyText: url,
      openUrl: url,
    });
    return { cards: [card], speech: `Opening ${host}.`, autoCloseMs: 1500 };
  },
});

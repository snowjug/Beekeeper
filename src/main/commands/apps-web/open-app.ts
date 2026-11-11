import { matchAliases, queryVariants } from '../../system/appAliases';
import type { AppMatch } from '../../system/types';
import type { CommandResult } from '@shared/cards';
import { matchLeadingVerb, stripArticles } from '../text';
import { defineCommand } from '../types';
import type { RunContext } from '../types';
import { settingsPageFromText } from '../system-control/settings-pages';
import { browserFailure, failureResult, statusCard } from './cards';
import { parseWebsite } from './domain';
import { findKnownSite, type KnownSite } from './sites';

export interface OpenAppSlots {
  /** The app name as spoken, without articles ("vs code"). */
  query: string;
}

const OPEN_VERBS = ['open', 'launch', 'start', 'run', 'fire up', 'boot up', 'bring up', 'load'];
/** "start" and "run" are used for many other things ("start a timer", "run a check"). */
const AMBIGUOUS_VERBS: ReadonlySet<string> = new Set(['start', 'run']);
const MAX_QUERY_WORDS = 4;
/** "start" and "run" with an unknown name only count for short names ("start discord"). */
const MAX_AMBIGUOUS_WORDS = 3;
/** Words that stand for something said earlier, not for an app. */
const NOT_AN_APP: ReadonlySet<string> = new Set([
  'it',
  'that',
  'this',
  'something',
  'anything',
  'everything',
  'one',
  'again',
  'over',
  'all',
]);
/** Beekeeper's own settings window is command 27; Windows Settings is "settings app" or "windows settings". */
const BEEKEEPER_SETTINGS: ReadonlySet<string> = new Set([
  'settings',
  'preferences',
  'app settings',
  'beekeeper settings',
  'assistant settings',
]);
/** Words that may precede an address: "open the website bbc.co.uk". */
const ADDRESS_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'website',
  'web',
  'site',
  'page',
  'webpage',
  'url',
  'link',
  'address',
]);

// Launch when the best app is this good and clearly ahead of the runner-up.
const LAUNCH_SCORE = 0.75;
/** An app whose name is exactly what was said wins even over a well-known website ("open github"). */
const EXACT_SCORE = 0.97;
const LEAD_MARGIN = 0.1;
const RUNNER_UP_IGNORED_BELOW = 0.6;
const MAX_CHOICES = 3;

function cleanQuery(rest: string): string {
  return stripArticles(rest)
    .replace(/^up\s+/, '')
    .trim();
}

/** Web addresses, URLs and file paths are never app names: they belong to the open-website command. */
function looksLikeAddress(query: string): boolean {
  if (/[\\/:]/.test(query)) return true;
  const words = query.split(' ');
  const last = words.at(-1) ?? '';
  return parseWebsite(last) !== null && words.slice(0, -1).every((word) => ADDRESS_WORDS.has(word));
}

export const openAppCommand = defineCommand<OpenAppSlots>({
  id: 'open-app',
  number: 1,
  group: 'apps-web',
  title: 'Open an app',
  icon: 'app',
  examples: [
    'Open Notepad',
    'Launch Chrome',
    'Start Spotify',
    'Open VS Code',
    'Fire up Calculator',
    'Run Task Manager',
    'Open the File Explorer',
  ],

  match(input) {
    const verb = matchLeadingVerb(input.text, OPEN_VERBS);
    if (verb === null) return null;
    const query = cleanQuery(verb.rest);
    if (query === '' || query.split(' ').length > MAX_QUERY_WORDS || NOT_AN_APP.has(query)) {
      return null;
    }
    // Other commands own these: Windows settings pages (22), Beekeeper's settings (27), websites (5).
    if (settingsPageFromText(input.text) !== null || BEEKEEPER_SETTINGS.has(query)) return null;
    if (looksLikeAddress(query)) return null;

    const known = matchAliases(queryVariants(query)).length > 0 || findKnownSite(query) !== null;
    if (!verb.exact) return known ? { slots: { query }, score: 0.85 } : null;
    if (known) return { slots: { query }, score: 0.93 };
    if (!AMBIGUOUS_VERBS.has(verb.verb)) return { slots: { query }, score: 0.62 };
    return query.split(' ').length > MAX_AMBIGUOUS_WORDS ? null : { slots: { query }, score: 0.52 };
  },

  async run({ query }, ctx) {
    const { system } = ctx.services;
    let matches: AppMatch[] = [];
    let lookupError: unknown;
    try {
      matches = await system.findApps(query, MAX_CHOICES + 2);
    } catch (error) {
      lookupError = error;
    }

    const [best, second] = matches;
    const clearWinner = best !== undefined && isClearWinner(best, second);

    if (best !== undefined && clearWinner && best.score >= EXACT_SCORE) return launch(ctx, best);
    const site = findKnownSite(query);
    if (site !== null) return openSite(ctx, site);
    if (best !== undefined && clearWinner && best.score >= LAUNCH_SCORE) return launch(ctx, best);
    if (matches.length > 0) return askWhich(ctx, query, matches.slice(0, MAX_CHOICES));
    if (lookupError !== undefined) return failureResult(ctx, 'look through your apps', lookupError);
    return notFound(ctx, query);
  },
});

/**
 * An app wins when nothing comes close to it: the runner-up is weak, the lead is clear, or the
 * best app has exactly the spoken name ("notepad" beats "Notepad++").
 */
function isClearWinner(best: AppMatch, runnerUp: AppMatch | undefined): boolean {
  if (runnerUp === undefined || runnerUp.score < RUNNER_UP_IGNORED_BELOW) return true;
  if (best.score >= EXACT_SCORE && runnerUp.score < EXACT_SCORE) return true;
  return best.score - runnerUp.score >= LEAD_MARGIN - 1e-9;
}

async function launch(ctx: RunContext, match: AppMatch): Promise<CommandResult> {
  const { name } = match.app;
  try {
    await ctx.services.system.launchApp(match.app);
  } catch (error) {
    return failureResult(ctx, `open ${name}`, error);
  }
  return {
    cards: [statusCard(ctx, { tone: 'success', icon: 'app', title: `Opening ${name}` })],
    speech: `Opening ${name}.`,
    autoCloseMs: 1500,
  };
}

async function openSite(ctx: RunContext, site: KnownSite): Promise<CommandResult> {
  let opened = false;
  try {
    opened = await ctx.services.ui.openExternal(site.url);
  } catch (error) {
    ctx.logger.warn(`Could not open ${site.url}`, error);
  }
  if (!opened) return browserFailure(ctx);
  return {
    cards: [
      statusCard(ctx, {
        tone: 'success',
        icon: 'web',
        title: `Opening ${site.title}`,
        detail: site.url,
        openUrl: site.url,
      }),
    ],
    speech: `Opening ${site.title}.`,
    autoCloseMs: 1500,
  };
}

function askWhich(ctx: RunContext, query: string, choices: readonly AppMatch[]): CommandResult {
  const [only] = choices;
  const single = choices.length === 1 && only !== undefined;
  const title = single ? `Did you mean ${only.app.name}?` : 'Which one did you mean?';
  const card = statusCard(ctx, {
    tone: 'warning',
    icon: 'app',
    title,
    detail: `"${query}" is close to ${single ? 'one app' : 'a few apps'} on this PC.`,
    actions: choices.map(({ app }) => ({
      type: 'command',
      label: `Open ${app.name}`,
      text: `open ${app.key}`,
    })),
  });
  return { cards: [card], speech: title, pin: true };
}

function notFound(ctx: RunContext, query: string): CommandResult {
  const card = statusCard(ctx, {
    tone: 'warning',
    icon: 'app',
    title: `I couldn't find "${query}"`,
    detail: "It doesn't look like an app that is installed on this PC.",
    actions: [{ type: 'command', label: 'Search the web', text: `search for ${query}` }],
  });
  return { cards: [card], speech: `I couldn't find ${query}.` };
}

import { displayNameFor, matchAliases, queryVariants } from '../../system/appAliases';
import type { CloseAppResult } from '../../system/types';
import { matchLeadingVerb, stripArticles } from '../text';
import { defineCommand } from '../types';
import { failureResult, statusCard } from './cards';

export interface CloseAppSlots {
  /** The app name as spoken, without articles ("vs code"). */
  query: string;
}

const CLOSE_VERBS = [
  'close',
  'quit',
  'exit',
  'kill',
  'terminate',
  'end',
  'force quit',
  'force close',
  'shut down',
];
/** Typos are only forgiven for the everyday verbs; "edit notepad" must never close Notepad. */
const TYPO_TOLERATED_VERBS: ReadonlySet<string> = new Set(['close', 'quit']);
/** Blunt verbs score lower for unknown names so that a better matching command can win. */
const BLUNT_VERBS: ReadonlySet<string> = new Set(['kill', 'terminate', 'end', 'exit']);
const MAX_QUERY_WORDS = 4;
/** What these words stand for is not an app (command 28 and the UI handle them). */
const NOT_AN_APP: ReadonlySet<string> = new Set([
  'it',
  'that',
  'this',
  'them',
  'me',
  'you',
  'yourself',
  'everything',
  'all',
  'all windows',
  'all apps',
  'all programs',
  'window',
  'windows',
  'this window',
  'that window',
  'current window',
  'tab',
  'tabs',
  'this tab',
  'current tab',
  'popup',
  'dialog',
  'app',
  'program',
  'application',
  'this app',
  'that app',
  'current app',
  'beekeeper',
  'assistant',
  'bar',
  'lid',
  'door',
]);
/** "shut down my PC" is the power command (24), not an app. */
const COMPUTER_WORDS: ReadonlySet<string> = new Set([
  'pc',
  'computer',
  'laptop',
  'machine',
  'system',
  'desktop',
  'device',
  'notebook',
  'workstation',
  'tablet',
  'now',
  'down',
  'everything',
]);

function cleanQuery(rest: string): string {
  let query = stripArticles(rest).replace(/^down\s+/, '');
  if (/^task\s+(?!manager$|mgr$)\S/.test(query)) query = query.replace(/^task\s+/, '');
  query = query.replace(/\s+(?:app|application|program|window|windows|process)$/, '');
  return stripArticles(query).trim();
}

export const closeAppCommand = defineCommand<CloseAppSlots>({
  id: 'close-app',
  number: 2,
  group: 'apps-web',
  title: 'Close an app',
  icon: 'app',
  examples: [
    'Close Notepad',
    'Quit Chrome',
    'Exit Spotify',
    'Kill Task Manager',
    'Shut down Notepad',
    'Close the calculator',
  ],

  match(input) {
    const verb = matchLeadingVerb(input.text, CLOSE_VERBS);
    if (verb === null) return null;
    const query = cleanQuery(verb.rest);
    if (query === '' || query.split(' ').length > MAX_QUERY_WORDS || NOT_AN_APP.has(query)) {
      return null;
    }
    if (verb.verb === 'shut down' && COMPUTER_WORDS.has(query)) return null;

    const known = matchAliases(queryVariants(query)).length > 0;
    if (!verb.exact) {
      return known && TYPO_TOLERATED_VERBS.has(verb.verb)
        ? { slots: { query }, score: 0.85 }
        : null;
    }
    const score = known ? 0.93 : BLUNT_VERBS.has(verb.verb) ? 0.58 : 0.62;
    return { slots: { query }, score };
  },

  async run({ query }, ctx) {
    const { system, confirm } = ctx.services;
    const name = displayNameFor(query);

    let result: CloseAppResult;
    try {
      result = await system.closeApp(query);
    } catch (error) {
      return failureResult(ctx, `close ${name}`, error);
    }

    if (result.status === 'closed') {
      return {
        cards: [statusCard(ctx, { tone: 'success', icon: 'app', title: `Closed ${name}` })],
        speech: `Closed ${name}.`,
        autoCloseMs: 1500,
      };
    }
    if (result.status === 'not-running') {
      const card = statusCard(ctx, {
        tone: 'neutral',
        icon: 'app',
        title: `${name} isn't running`,
        detail: "I couldn't find any open windows for it.",
      });
      return { cards: [card], speech: `${name} isn't running.` };
    }

    const card = confirm.request({
      action: 'force-close',
      title: `${name} didn't close`,
      detail: 'It may be asking you to save your work. Force closing loses any unsaved changes.',
      confirmLabel: 'Force close',
      danger: true,
      run: async () => {
        await system.closeApp(query, { force: true });
      },
    });
    return { cards: [card], speech: `${name} didn't close. Force close it?`, pin: true };
  },
});

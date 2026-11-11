import type { CardIcon } from '@shared/cards';
import type { SettingsPage } from '../../system/types';
import { failureResult, statusCard } from '../apps-web/cards';
import { matchPhrase } from '../text';
import { defineCommand } from '../types';

export interface ParsedSettingsPage {
  page: SettingsPage;
  score: number;
}

export interface SettingsPageSlots {
  page: SettingsPage;
}

/** What people call each Windows settings page. */
const PAGE_PHRASES: Readonly<Record<SettingsPage, readonly string[]>> = {
  wifi: [
    'wifi',
    'wi fi',
    'wi-fi',
    'wireless',
    'wireless network',
    'wifi network',
    'network',
    'internet',
    'wlan',
    'network and internet',
  ],
  bluetooth: ['bluetooth', 'blue tooth', 'bluetooth and devices', 'bluetooth devices'],
  display: ['display', 'screen', 'monitor', 'brightness', 'resolution', 'screen resolution'],
  sound: ['sound', 'audio', 'volume', 'speaker', 'speakers', 'sound and audio'],
};
const PHRASE_PAGES = new Map<string, SettingsPage>(
  (Object.entries(PAGE_PHRASES) as Array<[SettingsPage, readonly string[]]>).flatMap(
    ([page, phrases]) => phrases.map((phrase): [string, SettingsPage] => [phrase, page]),
  ),
);
const ALL_PHRASES: readonly string[] = [...PHRASE_PAGES.keys()];

const VERB = String.raw`(?:(?:open|show(?:\s+me)?|go\s+to|take\s+me\s+to|launch|view|bring\s+up|pull\s+up|check|adjust|manage|configure|access|change|see)\s+)?`;
const DETERMINERS = String.raw`(?:(?:the|my|windows|system|pc)\s+)*`;
/** "wifi settings", "open the sound settings", "show me my display options". */
const WITH_SUFFIX = new RegExp(
  String.raw`^${VERB}${DETERMINERS}(.+?)\s+(?:settings|setting|options|preferences|page|panel)$`,
);
/** "open wifi", "open bluetooth": only for pages that are not also everyday words. */
const BARE = new RegExp(
  String.raw`^(?:open|show(?:\s+me)?|go\s+to|launch|view)\s+(?:the\s+|my\s+)?(wi-?fi|wi\s+fi|bluetooth)$`,
);

/**
 * Recognises requests for a Windows settings page ("open wifi settings", "sound settings",
 * "show me the display options"). Used by command 22 and by open-app to leave these phrases alone.
 */
export function settingsPageFromText(text: string): ParsedSettingsPage | null {
  const phrase = WITH_SUFFIX.exec(text)?.[1];
  if (phrase !== undefined) {
    const known = matchPhrase(phrase, ALL_PHRASES);
    const page = known === null ? undefined : PHRASE_PAGES.get(known);
    if (page !== undefined) return { page, score: 0.95 };
  }
  const bare = BARE.exec(text)?.[1];
  if (bare !== undefined) {
    const page = PHRASE_PAGES.get(bare.replace(/\s+/, ' '));
    if (page !== undefined) return { page, score: 0.9 };
  }
  return null;
}

const LABELS: Readonly<Record<SettingsPage, string>> = {
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  display: 'Display',
  sound: 'Sound',
};
const ICONS: Readonly<Record<SettingsPage, CardIcon>> = {
  wifi: 'wifi',
  bluetooth: 'bluetooth',
  display: 'display',
  sound: 'sound',
};

export const settingsPagesCommand = defineCommand<SettingsPageSlots>({
  id: 'settings-pages',
  number: 22,
  group: 'system',
  title: 'Windows settings',
  icon: 'settings',
  examples: [
    'Open Wi-Fi settings',
    'Bluetooth settings',
    'Open display settings',
    'Sound settings',
    'Show me the sound settings',
    'Open network settings',
  ],
  // Beats the generic "open <app>" matcher on phrases both could claim.
  priority: 5,

  match(input) {
    const parsed = settingsPageFromText(input.text);
    return parsed === null ? null : { slots: { page: parsed.page }, score: parsed.score };
  },

  async run({ page }, ctx) {
    const label = LABELS[page];
    try {
      await ctx.services.system.openSettingsPage(page);
    } catch (error) {
      return failureResult(ctx, `open the ${label} settings`, error);
    }
    const card = statusCard(ctx, {
      tone: 'success',
      icon: ICONS[page],
      title: `Opening ${label} settings`,
    });
    return { cards: [card], speech: `Opening ${label} settings.`, autoCloseMs: 1500 };
  },
});

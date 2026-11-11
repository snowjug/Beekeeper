import type { GalleryCard } from '@shared/cards';
import { correctTokens } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { matchPhrase } from '../text';
import { defineCommand } from '../types';
import type { AnyCommandModule, CommandGroup } from '../types';

interface SettingsAndHelpSlots {
  action: 'settings' | 'help';
}

/** Only the bare word: "open wifi settings" and "open the settings app" belong to other commands. */
const SETTINGS_PATTERN =
  /^(?:(?:open|show|launch|go to|bring up|pull up)\s+)?(?:the\s+|my\s+)?(?:(?:beekeeper|assistant)\s+)?(?:settings|preferences)(?:\s+(?:window|panel|page))?$/;
const SETTINGS_VOCABULARY = ['settings', 'preferences'];

const HELP_PHRASES = [
  'help',
  'help me',
  'show help',
  'open help',
  'get help',
  'i need help',
  'what can you do',
  'what can you do for me',
  'what can i say',
  'what can i ask',
  'what can i ask you',
  'what can i say to you',
  'what can beekeeper do',
  'what do you do',
  'what are you capable of',
  'what are your capabilities',
  'what are your features',
  'what are your commands',
  'what features do you have',
  'what commands do you have',
  'what commands are available',
  'what commands are there',
  'what commands can i use',
  'what commands can i say',
  'show commands',
  'show me commands',
  'show all commands',
  'show me all commands',
  'show the commands',
  'show me the commands',
  'list commands',
  'list all commands',
  'list the commands',
  'list of commands',
  'show command list',
  'commands',
  'command list',
  'command gallery',
  'show command gallery',
  'show the command gallery',
  'open command gallery',
  'open the command gallery',
  'show me what you can do',
  'show what you can do',
  'tell me what you can do',
];

const GROUP_ORDER: ReadonlyArray<readonly [CommandGroup, string]> = [
  ['apps-web', 'Apps & web'],
  ['info', 'Info'],
  ['productivity', 'Productivity'],
  ['system', 'System'],
  ['assistant', 'Assistant'],
];
const EXAMPLES_PER_COMMAND = 3;

/** Groups the registered commands for the "what can you do" gallery, in spec order. */
export function buildGallery(commands: readonly AnyCommandModule[]): GalleryCard['groups'] {
  return GROUP_ORDER.flatMap(([group, title]) => {
    const members = commands
      .filter((command) => command.group === group)
      .sort((a, b) => a.number - b.number)
      .map((command) => ({
        title: command.title,
        icon: command.icon,
        examples: command.examples.slice(0, EXAMPLES_PER_COMMAND),
      }));
    return members.length > 0 ? [{ title, commands: members }] : [];
  });
}

export const settingsAndHelpCommand = defineCommand<SettingsAndHelpSlots>({
  id: 'settings-and-help',
  number: 27,
  group: 'assistant',
  title: 'Settings & help',
  icon: 'help',
  examples: ['Open settings', 'What can you do?', 'Help', 'Show commands'],
  // "open settings" must beat the generic open-app matcher.
  priority: 10,

  match(input) {
    if (SETTINGS_PATTERN.test(input.text)) {
      return { slots: { action: 'settings' }, score: 0.97 };
    }
    const fixed = correctTokens(input.tokens, SETTINGS_VOCABULARY, (index) => index < 4);
    if (fixed.corrected && SETTINGS_PATTERN.test(fixed.tokens.join(' '))) {
      return { slots: { action: 'settings' }, score: 0.85 };
    }

    const help = matchPhrase(input.text, HELP_PHRASES);
    if (help === null) return null;
    return { slots: { action: 'help' }, score: help === input.text ? 0.97 : 0.8 };
  },

  run(slots, ctx) {
    if (slots.action === 'settings') {
      ctx.services.ui.openSettings();
      const card = statusCard(ctx, {
        tone: 'neutral',
        icon: 'settings',
        title: 'Opening settings',
      });
      return { cards: [card], speech: 'Opening settings.', autoCloseMs: 1200 };
    }

    const gallery: GalleryCard = {
      kind: 'gallery',
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      groups: buildGallery(ctx.services.listCommands()),
    };
    return { cards: [gallery], speech: "Here's what I can do.", pin: true };
  },
});

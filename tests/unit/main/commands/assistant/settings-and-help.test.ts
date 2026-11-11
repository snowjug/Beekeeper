import { describe, expect, it } from 'vitest';
import type { GalleryCard, StatusCard } from '@shared/cards';
import { settingsAndHelpCommand, buildGallery } from '@main/commands/assistant/settings-and-help';
import { circleToSearchCommand } from '@main/commands/assistant/circle-to-search';
import { stopCommand } from '@main/commands/assistant/stop';
import { infoCommands } from '@main/commands/groups/info';
import { defineCommand } from '@main/commands/types';
import type { AnyCommandModule, CommandGroup } from '@main/commands/types';
import { createFakeServices, matchOf, runContext } from '../helpers';

function fake(
  id: string,
  number: number,
  group: CommandGroup,
  examples: string[] = ['one', 'two', 'three', 'four'],
): AnyCommandModule {
  return defineCommand({
    id,
    number,
    group,
    title: `Title ${id}`,
    icon: 'info',
    examples,
    match: () => null,
    run: () => ({ cards: [] }),
  });
}

describe('settings: phrases', () => {
  it.each([
    'open settings',
    'settings',
    'Beekeeper settings',
    'open beekeeper settings',
    'open my settings',
    'open the settings',
    'open the beekeeper settings',
    'show settings',
    'show my settings',
    'launch settings',
    'go to settings',
    'open assistant settings',
    'settings window',
    'preferences',
    'open preferences',
  ])('%s', (text) => {
    expect(matchOf(settingsAndHelpCommand, text)).toEqual({
      slots: { action: 'settings' },
      score: 0.97,
    });
  });

  it('repairs a typo with a lower score', () => {
    expect(matchOf(settingsAndHelpCommand, 'setings')).toEqual({
      slots: { action: 'settings' },
      score: 0.85,
    });
    expect(matchOf(settingsAndHelpCommand, 'open settngs')).toEqual({
      slots: { action: 'settings' },
      score: 0.85,
    });
  });

  it.each([
    'open wifi settings',
    'open wi-fi settings',
    'open bluetooth settings',
    'open display settings',
    'open sound settings',
    'open the settings app',
    'open settings app',
    'settings app',
    'change my settings',
    'volume settings',
    'open notepad',
    '',
  ])('leaves %j to the other commands', (text) => {
    expect(matchOf(settingsAndHelpCommand, text)).toBeNull();
  });

  it('outranks the generic open-app matcher', () => {
    expect(settingsAndHelpCommand.priority).toBeGreaterThan(0);
  });
});

describe('help: phrases', () => {
  it.each([
    'what can you do',
    'What can you do?',
    'what can you do for me',
    'help',
    'help me',
    'show commands',
    'show me all commands',
    'what can i say',
    'what can i ask you',
    'list commands',
    'list of commands',
    'commands',
    'command gallery',
    'show the command gallery',
    'what are your features',
    'what commands do you have',
    'what can beekeeper do',
    'tell me what you can do',
    'Hey Beekeeper, help',
  ])('%s', (text) => {
    expect(matchOf(settingsAndHelpCommand, text)).toEqual({
      slots: { action: 'help' },
      score: 0.97,
    });
  });

  it('forgives a typo with a lower score', () => {
    expect(matchOf(settingsAndHelpCommand, 'wat can you do')).toEqual({
      slots: { action: 'help' },
      score: 0.8,
    });
  });

  it.each([
    'help me with my homework',
    'help me find my keys',
    'what can you do about it',
    'what can i wear',
    'show my notes',
    'list my notes',
    'halp',
  ])('ignores %j', (text) => {
    expect(matchOf(settingsAndHelpCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(settingsAndHelpCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of settingsAndHelpCommand.examples) {
      expect(matchOf(settingsAndHelpCommand, example), example).not.toBeNull();
    }
  });
});

describe('settings and help: answers', () => {
  it('opens the settings window', () => {
    const services = createFakeServices();
    const result = settingsAndHelpCommand.run({ action: 'settings' }, runContext({ services }));
    expect(services.ui.openSettings).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ speech: 'Opening settings.', autoCloseMs: 1200 });
    expect((result as { cards: StatusCard[] }).cards[0]).toMatchObject({
      kind: 'status',
      icon: 'settings',
      title: 'Opening settings',
    });
  });

  it('shows a gallery of every registered command and keeps it open', () => {
    const commands = [...infoCommands, circleToSearchCommand, settingsAndHelpCommand, stopCommand];
    const services = createFakeServices(commands);
    const result = settingsAndHelpCommand.run({ action: 'help' }, runContext({ services })) as {
      cards: GalleryCard[];
      speech: string;
      pin: boolean;
    };
    const gallery = result.cards[0];
    expect(gallery).toMatchObject({ kind: 'gallery', id: 'id-1' });
    expect(gallery?.groups.map((group) => group.title)).toEqual(['Info', 'Assistant']);
    expect(gallery?.groups[0]?.commands.map((command) => command.title)).toEqual([
      'Time & date',
      'Weather',
      'Battery',
      'System info',
      'Calculator',
      'Unit converter',
      'Dictionary',
      'Daily briefing',
    ]);
    expect(result.pin).toBe(true);
    expect(result.speech).toBe("Here's what I can do.");
  });
});

describe('buildGallery', () => {
  it('groups by command group in a fixed order and sorts by number', () => {
    const gallery = buildGallery([
      fake('stop', 28, 'assistant'),
      fake('timer', 13, 'productivity'),
      fake('volume', 18, 'system'),
      fake('weather', 7, 'info'),
      fake('time', 6, 'info'),
      fake('open', 1, 'apps-web'),
    ]);
    expect(gallery.map((group) => group.title)).toEqual([
      'Apps & web',
      'Info',
      'Productivity',
      'System',
      'Assistant',
    ]);
    expect(gallery[1]?.commands.map((command) => command.title)).toEqual([
      'Title time',
      'Title weather',
    ]);
  });

  it('skips empty groups and shows at most three examples per command', () => {
    const gallery = buildGallery([fake('weather', 7, 'info')]);
    expect(gallery).toHaveLength(1);
    expect(gallery[0]?.commands[0]).toEqual({
      title: 'Title weather',
      icon: 'info',
      examples: ['one', 'two', 'three'],
    });
    expect(buildGallery([])).toEqual([]);
  });

  it('does not reorder or mutate the input', () => {
    const input = [fake('b', 7, 'info'), fake('a', 6, 'info')];
    buildGallery(input);
    expect(input.map((command) => command.id)).toEqual(['b', 'a']);
  });
});

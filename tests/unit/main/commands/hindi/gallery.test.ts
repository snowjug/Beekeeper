import { describe, expect, it } from 'vitest';
import { GALLERY_COMMANDS, GALLERY_GROUPS } from '@main/commands/hindi/localize/gallery';
import { understand } from './support';

/** The command each gallery entry stands for. */
const COMMAND_OF: Readonly<Record<string, string>> = {
  'Open an app': 'open-app',
  'Close an app': 'close-app',
  'Search the web': 'web-search',
  'Play on YouTube': 'youtube',
  'Open a website': 'open-website',
  'Time & date': 'datetime',
  Weather: 'weather',
  Battery: 'battery',
  'System info': 'system-info',
  Calculator: 'calculate',
  'Unit converter': 'convert',
  Dictionary: 'define',
  Timers: 'timer',
  Reminders: 'reminder',
  Alarms: 'alarm',
  Notes: 'notes',
  'Copy that': 'copy-that',
  Volume: 'volume',
  Brightness: 'brightness',
  Screenshot: 'screenshot',
  'Lock the PC': 'lock',
  'Windows settings': 'settings-pages',
  'Empty the Recycle Bin': 'recycle-bin',
  'Shut down, restart or sleep': 'power',
  'Dark mode': 'dark-mode',
  'Circle to Search': 'circle-to-search',
  'Settings & help': 'settings-and-help',
  Stop: 'stop',
  'Daily briefing': 'briefing',
  Repeat: 'repeat',
  Dictation: 'dictate',
};

describe('the Hindi command gallery', () => {
  it('has an entry for every command it knows, with three examples each', () => {
    expect(Object.keys(GALLERY_COMMANDS).sort()).toEqual(Object.keys(COMMAND_OF).sort());
    for (const entry of Object.values(GALLERY_COMMANDS)) {
      expect(entry.title).not.toBe('');
      expect(entry.examples).toHaveLength(3);
    }
  });

  it('names the five groups', () => {
    expect(Object.keys(GALLERY_GROUPS)).toEqual([
      'Apps & web',
      'Info',
      'Productivity',
      'System',
      'Assistant',
    ]);
  });

  const examples = Object.entries(GALLERY_COMMANDS).flatMap(([title, entry]) =>
    entry.examples.map((example): [string, string, string] => [
      title,
      example,
      COMMAND_OF[title] ?? '',
    ]),
  );

  // The example chips send their text back to the assistant: each one must work.
  it.each(examples)('%s: "%s"', (_title, example, command) => {
    const { spoken, intent } = understand(example);
    expect(spoken.locale).toBe('hi');
    expect(intent?.command.id, `"${example}" -> "${spoken.text}"`).toBe(command);
  });
});

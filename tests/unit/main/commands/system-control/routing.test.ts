import { describe, expect, it } from 'vitest';
import { createCommandEngine } from '@main/commands/engine';
import { appsWebCommands } from '@main/commands/groups/apps-web';
import { systemCommands } from '@main/commands/groups/system';
import { buildRegistry } from '@main/commands/registry';
import { NOW } from '../apps-web/support';

const modules = buildRegistry([appsWebCommands, systemCommands]);
const engine = createCommandEngine({ modules });

function route(text: string): string | null {
  return engine.parse(text, { now: NOW, turns: [] })?.command.id ?? null;
}

describe('command registration', () => {
  it('registers commands 1-5 and 18-25 with unique ids and numbers', () => {
    expect(modules.map((module) => module.number)).toEqual([
      1, 2, 3, 4, 5, 18, 19, 20, 21, 22, 23, 24, 25,
    ]);
    expect(new Set(modules.map((module) => module.id)).size).toBe(modules.length);
  });

  it('uses the group names the registry expects', () => {
    for (const module of modules) {
      expect(module.group, module.id).toBe(module.number <= 5 ? 'apps-web' : 'system');
    }
  });

  it('gives every command a title, an icon and at least three examples', () => {
    for (const module of modules) {
      expect(module.title.length, module.id).toBeGreaterThan(0);
      expect(module.examples.length, module.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('every example is routed to its own command', () => {
  for (const module of modules) {
    it.each(module.examples)(`${module.id}: "%s"`, (example) => {
      expect(route(example)).toBe(module.id);
    });
  }
});

describe('cross-command ambiguity', () => {
  it.each([
    // apps, settings pages and websites
    ['open notepad', 'open-app'],
    ['open youtube', 'open-app'],
    ['open the settings app', 'open-app'],
    ['open windows settings', 'open-app'],
    ['open sound recorder', 'open-app'],
    ['open wifi settings', 'settings-pages'],
    ['open wi-fi', 'settings-pages'],
    ['open network settings', 'settings-pages'],
    ['open display settings', 'settings-pages'],
    ['open the sound settings', 'settings-pages'],
    ['volume settings', 'settings-pages'],
    ['brightness settings', 'settings-pages'],
    ['open github.com', 'open-website'],
    ['open the website bbc.co.uk', 'open-website'],
    ['go to example.org', 'open-website'],
    ['visit https://news.ycombinator.com', 'open-website'],
    ['github.com', 'open-website'],
    ['open node.js', 'open-app'],
    // "open settings" is Beekeeper's own settings window (command 27, not part of this group)
    ['open settings', null],
    ['open my settings', null],
    // closing apps and power
    ['close notepad', 'close-app'],
    ['quit chrome', 'close-app'],
    ['kill task manager', 'close-app'],
    ['shut down notepad', 'close-app'],
    ['shut down', 'power'],
    ['shutdown', 'power'],
    ['shut down my pc', 'power'],
    ['turn off my computer', 'power'],
    ['power off the pc', 'power'],
    ['restart', 'power'],
    ['restart my computer', 'power'],
    ['restart notepad', null],
    ['sleep', 'power'],
    ['go to sleep', 'power'],
    ['hibernate', 'power'],
    ['turn off dark mode', 'dark-mode'],
    ['turn off the sound', 'volume'],
    ['turn off the lights', null],
    // searching
    ['search for cats', 'web-search'],
    ['google best pizza', 'web-search'],
    ['search youtube for cats', 'youtube'],
    ['play despacito on youtube', 'youtube'],
    ['search for cats on youtube', 'youtube'],
    ['search my screen', null],
    ['what is the weather', null],
    // levels
    ['turn it up', 'volume'],
    ['turn it down', 'volume'],
    ['louder', 'volume'],
    ['mute', 'volume'],
    ['volume 40', 'volume'],
    ['dim the screen', 'brightness'],
    ['make the screen brighter', 'brightness'],
    ['brightness 70', 'brightness'],
    ['what is the volume of a sphere with radius 3', null],
    // others
    ['lock my pc', 'lock'],
    ['lock the door', null],
    ['take a screenshot', 'screenshot'],
    ['empty the recycle bin', 'recycle-bin'],
    ['toggle dark mode', 'dark-mode'],
  ] as const)('"%s" -> %s', (text, expected) => {
    expect(route(text)).toBe(expected);
  });

  it('keeps wake words and politeness out of the way', () => {
    expect(route('Hey Beekeeper, could you please open Notepad?')).toBe('open-app');
    expect(route('OK Beekeeper, shut down my computer')).toBe('power');
    expect(route('Hey Beekeeper volume up please')).toBe('volume');
  });
});

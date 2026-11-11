import { describe, expect, it } from 'vitest';
import { createCommandEngine } from '@main/commands/engine';
import { allCommands } from '@main/commands/registry';
import { parseContext } from './helpers';

/**
 * The same parser the app uses, with every command registered: the commands must not steal each
 * other's phrases ("open wifi settings" is not "open <app>"), and phrasing variants, synonyms and
 * small typos must still reach the intended command.
 */
const engine = createCommandEngine({ modules: allCommands });
const idFor = (text: string): string | null =>
  engine.parse(text, parseContext())?.command.id ?? null;

const PHRASES: Record<string, readonly string[]> = {
  // Apps & web
  'open-app': [
    'open notepad',
    'launch calculator',
    'start spotify',
    'open vs code',
    'open visual studio code',
    'open task manager',
    'open file explorer',
    'open the calculator',
    'open outlook',
    'open teams',
    'open edge',
    'open the settings app',
    'can you open chrome',
    'please open notepad',
  ],
  'close-app': ['close notepad', 'quit spotify', 'close chrome', 'exit calculator', 'close teams'],
  'web-search': [
    'search for cats',
    'google the weather in paris',
    'bing best pizza near me',
    'search the web for electron docs',
    'google how to tie a tie',
    'look up typescript generics',
  ],
  youtube: [
    'play despacito on youtube',
    'youtube lo-fi beats',
    'play lofi hip hop on youtube',
    'watch cat videos on youtube',
  ],
  'open-website': [
    'open github.com',
    'go to wikipedia.org',
    'open https://news.ycombinator.com',
    'visit microsoft.com',
    'open www.bing.com',
  ],

  // Information
  datetime: [
    'what time is it',
    "what's the date",
    'what day is it',
    'what time is it in tokyo',
    "what is today's date",
    'current time',
    'what is the time in london',
  ],
  weather: [
    'weather',
    'weather in london',
    'will it rain tomorrow',
    'how hot is it',
    'what is the temperature in berlin',
    'is it going to snow in oslo',
    'weather forecast for seattle',
    "what's the weather like",
  ],
  battery: [
    'battery status',
    'how much battery do i have left',
    'battery level',
    'check my battery',
  ],
  'system-info': [
    'system info',
    'how much ram do i have',
    'cpu usage',
    'how much disk space is free',
    'how long has my pc been on',
    'show system information',
  ],
  calculate: [
    'calculate 15% of 2400',
    '5 times 7',
    'what is 2 to the power of 10',
    'calculate (3 + 4) * 5',
    '12 divided by 4',
    'what is 20% of 150',
    'square root of 144',
    'calculate 2^8',
  ],
  convert: [
    "what's 5 km in miles",
    '10 pounds in kg',
    'convert 100 fahrenheit to celsius',
    '3 gb to mb',
    'convert 2 meters to feet',
    'how many ounces in 2 pounds',
  ],
  define: [
    'define serendipity',
    'what does ephemeral mean',
    'meaning of ubiquitous',
    'definition of ennui',
    'define the word ambiguous',
  ],

  // Productivity
  timer: [
    'set a timer for 5 minutes',
    'timer 30 seconds',
    'start a 10 minute timer',
    'set a timer for 1 second',
    'set a timer for 1 hour and 30 minutes',
    'timer for 90 seconds',
  ],
  reminder: [
    'remind me in 10 minutes to call mom',
    'remind me at 5pm to submit the report',
    'remind me tomorrow at 9 am to buy milk',
    'set a reminder for 3 pm to stretch',
  ],
  alarm: ['set an alarm for 7:30', 'alarm for 6 am', 'wake me up at 6:45', 'set alarm 22:15'],
  notes: [
    'take a note buy milk',
    'show my notes',
    'delete last note',
    'note to self call the dentist',
    'add a note pick up dry cleaning',
    'delete my last note',
    'read my notes',
  ],
  'copy-that': ['copy that', 'copy the answer', 'copy this'],

  // System control
  volume: [
    'volume up',
    'volume down',
    'mute',
    'unmute',
    'set volume to 40%',
    'turn the volume up',
    'turn it down',
    'volume 30',
    'make it louder',
  ],
  brightness: [
    'brightness up',
    'brightness down',
    'set brightness to 70%',
    'make the screen brighter',
    'dim the screen',
  ],
  screenshot: ['take a screenshot', 'screenshot', 'capture the screen', 'grab a screenshot'],
  lock: ['lock my pc', 'lock the computer', 'lock screen', 'lock my computer'],
  'settings-pages': [
    'open wifi settings',
    'open wi-fi settings',
    'open bluetooth settings',
    'open display settings',
    'open sound settings',
    'bluetooth settings',
  ],
  'recycle-bin': ['empty recycle bin', 'empty the recycle bin', 'clear the recycle bin'],
  power: [
    'shut down my pc',
    'shutdown',
    'restart the computer',
    'restart',
    'put the computer to sleep',
    'sleep',
    'reboot',
  ],
  'dark-mode': ['toggle dark mode', 'turn on dark mode', 'switch to light mode', 'dark mode'],

  // Assistant
  'circle-to-search': ['circle to search', 'search my screen', 'start circle to search'],
  'settings-and-help': [
    'open settings',
    'what can you do',
    'help',
    'show commands',
    'open beekeeper settings',
  ],
  stop: ['stop', 'cancel', 'never mind', 'nevermind'],
};

const TYPOS: Array<[string, string]> = [
  ['opne notepad', 'open-app'],
  ['open notepda', 'open-app'],
  ['wether in paris', 'weather'],
  ['whats the wether tomorow', 'weather'],
  ['calcualte 5 plus 5', 'calculate'],
  ['set a timr for 5 minutes', 'timer'],
  ['remnd me in 5 minutes to stretch', 'reminder'],
  ['take a scrnshot', 'screenshot'],
  ['batery status', 'battery'],
  ['defin serendipity', 'define'],
  ['volum up', 'volume'],
  ['brigthness down', 'brightness'],
  ['lcok my pc', 'lock'],
];

// Things for the AI / web-search fallback: no command may claim them.
const FALLBACK = [
  'tell me a joke',
  'who painted the mona lisa',
  'what is love',
  'why is the sky blue',
  'write a haiku about autumn',
  'how do i center a div',
  '',
  '   ',
];

describe('intent routing across all commands', () => {
  const cases = Object.entries(PHRASES).flatMap(([id, phrases]) =>
    phrases.map((phrase) => [phrase, id] as const),
  );

  it('covers every command module and at least 100 phrases', () => {
    const ids = new Set(allCommands.map((command) => command.id));
    expect([...ids].filter((id) => !(id in PHRASES))).toEqual([]);
    expect(Object.keys(PHRASES).filter((id) => !ids.has(id))).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  it.each(cases)('"%s" goes to %s', (phrase, id) => {
    expect(idFor(phrase)).toBe(id);
  });

  it.each(cases.filter((_, index) => index % 3 === 0))(
    '"%s" still goes to %s when it is shouted, padded or punctuated',
    (phrase, id) => {
      expect(idFor(`  ${phrase.toUpperCase()}!  `)).toBe(id);
      expect(idFor(`hey beekeeper, ${phrase}`)).toBe(id);
      expect(idFor(`${phrase}?`)).toBe(id);
    },
  );

  it.each(TYPOS)('understands the typo "%s" as %s', (phrase, id) => {
    expect(idFor(phrase)).toBe(id);
  });

  it.each(FALLBACK)('leaves "%s" to the AI / web-search fallback', (phrase) => {
    expect(idFor(phrase)).toBeNull();
  });

  it('extracts the slots of a few representative phrases', () => {
    const slots = (text: string): Record<string, unknown> | undefined =>
      engine.parse(text, parseContext())?.slots as Record<string, unknown> | undefined;
    expect(slots('weather in london')).toMatchObject({
      place: expect.stringMatching(/london/i) as string,
      day: 0,
    });
    expect(slots('will it rain tomorrow')).toMatchObject({ day: 1, question: 'rain' });
    expect(slots('set a timer for 5 minutes')).toMatchObject({
      action: 'start',
      durationMs: 300_000,
    });
    expect(slots('set volume to 40%')).toMatchObject({ action: 'set', percent: 40 });
    expect(slots('volum up')).toMatchObject({ action: 'step', direction: 'up' });
  });
});

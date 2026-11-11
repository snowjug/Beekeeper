import { describe, expect, it } from 'vitest';
import { productivityCommands } from '@main/commands/groups/productivity';
import { normalizeInput } from '@main/commands/text';
import type { AnyCommandModule } from '@main/commands/types';
import { NOW, createHarness } from './fakes';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Epoch ms of a local time in November 2026 (NOW is Tuesday 10 November, 16:22:36). */
function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 10, day, hour, minute, 0, 0).getTime();
}

function inMs(ms: number): number {
  return NOW.getTime() + ms;
}

interface Winner {
  command: AnyCommandModule;
  slots: unknown;
  score: number;
}

/** What the engine would do: the highest score among the commands wins, `priority` breaks ties. */
function parse(text: string): Winner | null {
  const harness = createHarness();
  const input = normalizeInput(text);
  let best: Winner | null = null;
  for (const command of productivityCommands) {
    const match = command.match(input, harness.parseContext());
    if (match === null) continue;
    const better =
      best === null ||
      match.score > best.score ||
      (match.score === best.score && (command.priority ?? 0) > (best.command.priority ?? 0));
    if (better) best = { command, slots: match.slots, score: match.score };
  }
  return best;
}

type Case = [text: string, id: string, slots: Record<string, unknown>];

const TIMER_CASES: Case[] = [
  ['set a timer for 5 minutes', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['timer for 30 seconds', 'timer', { action: 'start', durationMs: 30_000 }],
  ['5 minute timer', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['a 5 minute timer', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['start a 10 minute timer', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
  ['set a timer for 1 hour 30 minutes', 'timer', { action: 'start', durationMs: 90 * MINUTE }],
  [
    'timer for five minutes called pasta',
    'timer',
    { action: 'start', durationMs: 5 * MINUTE, label: 'Pasta' },
  ],
  [
    'set a timer for 2 minutes for tea',
    'timer',
    { action: 'start', durationMs: 2 * MINUTE, label: 'Tea' },
  ],
  [
    'set a pasta timer for 10 minutes',
    'timer',
    { action: 'start', durationMs: 10 * MINUTE, label: 'Pasta' },
  ],
  [
    'start a 10 minute pasta timer',
    'timer',
    { action: 'start', durationMs: 10 * MINUTE, label: 'Pasta' },
  ],
  [
    'set a timer called eggs for 6 minutes',
    'timer',
    { action: 'start', durationMs: 6 * MINUTE, label: 'Eggs' },
  ],
  ['set timer 5 minutes', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['set a 90 second timer', 'timer', { action: 'start', durationMs: 90_000 }],
  ['set a five minute timer', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['set up a timer for 5 minutes', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['create a timer for 3 minutes', 'timer', { action: 'start', durationMs: 3 * MINUTE }],
  ['make a timer for ten minutes', 'timer', { action: 'start', durationMs: 10 * MINUTE }],
  ['set a timer for an hour', 'timer', { action: 'start', durationMs: HOUR }],
  ['set a timer for half an hour', 'timer', { action: 'start', durationMs: 30 * MINUTE }],
  ['set a timer for 1h30m', 'timer', { action: 'start', durationMs: 90 * MINUTE }],
  ['set a timer for 2 and a half minutes', 'timer', { action: 'start', durationMs: 150_000 }],
  ['hey beekeeper, set a timer for 5 minutes please', 'timer', { durationMs: 5 * MINUTE }],
  ['could you set a timer for 20 seconds', 'timer', { durationMs: 20_000 }],
  ['set a timer', 'timer', { action: 'start', durationMs: null }],
  ['set a timer for banana', 'timer', { action: 'start', durationMs: null, label: 'Banana' }],
  ['how much time is left on my timer', 'timer', { action: 'list' }],
  ['how much longer on my timer', 'timer', { action: 'list' }],
  ['how much time is left', 'timer', { action: 'list' }],
  ['show my timers', 'timer', { action: 'list' }],
  ['list timers', 'timer', { action: 'list' }],
  ['what timers do i have', 'timer', { action: 'list' }],
  ['are there any timers running', 'timer', { action: 'list' }],
  ['timer status', 'timer', { action: 'list' }],
  ['timer', 'timer', { action: 'list' }],
  ['cancel my timer', 'timer', { action: 'cancel', target: { kind: 'latest' } }],
  ['stop the timer', 'timer', { action: 'cancel', target: { kind: 'latest' } }],
  ['turn off the timer', 'timer', { action: 'cancel', target: { kind: 'latest' } }],
  ['cancel all timers', 'timer', { action: 'cancel', target: { kind: 'all' } }],
  ['stop all timers', 'timer', { action: 'cancel', target: { kind: 'all' } }],
  ['clear timers', 'timer', { action: 'cancel', target: { kind: 'all' } }],
  [
    'cancel the pasta timer',
    'timer',
    { action: 'cancel', target: { kind: 'label', words: ['pasta'] } },
  ],
  [
    'cancel the 10 minute timer',
    'timer',
    { action: 'cancel', target: { kind: 'duration', ms: 10 * MINUTE } },
  ],
  ['cancel my timer called', 'timer', { action: 'cancel', target: { kind: 'latest' } }],
];

const TIMER_TYPOS: Case[] = [
  ['set a tiemr for 5 minutes', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['sett a timer for 5 minutes', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['strat a timer for 5 minutes', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['set a timer for 5 minuts', 'timer', { action: 'start', durationMs: 5 * MINUTE }],
  ['cancle my timer', 'timer', { action: 'cancel', target: { kind: 'latest' } }],
  ['shwo my timers', 'timer', { action: 'list' }],
];

const REMINDER_CASES: Case[] = [
  ['remind me in 10 minutes to call mom', 'reminder', { text: 'call mom', at: inMs(10 * MINUTE) }],
  [
    'remind me at 3:30 pm to submit the report',
    'reminder',
    { text: 'submit the report', at: at(11, 15, 30) },
  ],
  ['remind me to drink water in 1 hour', 'reminder', { text: 'drink water', at: inMs(HOUR) }],
  ['remind me to stretch at 5pm', 'reminder', { text: 'stretch', at: at(10, 17) }],
  ['remind me tomorrow at 9am to email john', 'reminder', { text: 'email john', at: at(11, 9) }],
  ['set a reminder for 6 pm to cook dinner', 'reminder', { text: 'cook dinner', at: at(10, 18) }],
  [
    'remind me in half an hour to check the oven',
    'reminder',
    { text: 'check the oven', at: inMs(30 * MINUTE) },
  ],
  ['Remind me to call John Smith at 5pm', 'reminder', { text: 'call John Smith', at: at(10, 17) }],
  ['remind me to email John tomorrow at 9am', 'reminder', { text: 'email John', at: at(11, 9) }],
  ['remind me at noon to eat lunch', 'reminder', { text: 'eat lunch', at: at(11, 12) }],
  ['remind me at 5 to pick up the kids', 'reminder', { text: 'pick up the kids', at: at(10, 17) }],
  [
    'remind me tonight at 8 to take out the trash',
    'reminder',
    { text: 'take out the trash', at: at(10, 20) },
  ],
  ['remind me tomorrow to call mom at 9', 'reminder', { text: 'call mom', at: at(11, 9) }],
  [
    'remind me about the meeting in 15 minutes',
    'reminder',
    { text: 'about the meeting', at: inMs(15 * MINUTE) },
  ],
  [
    'remind me that the meeting is at 5pm',
    'reminder',
    { text: 'that the meeting', at: at(10, 17) },
  ],
  [
    'remind me in 2 days to renew the passport',
    'reminder',
    { text: 'renew the passport', at: inMs(48 * HOUR) },
  ],
  [
    'remind me every day at 9am to take vitamins',
    'reminder',
    { text: 'take vitamins', at: at(11, 9), repeating: true },
  ],
  ['set a reminder to buy milk at 6 pm', 'reminder', { text: 'buy milk', at: at(10, 18) }],
  [
    'set a reminder in 5 minutes to check the oven',
    'reminder',
    { text: 'check the oven', at: inMs(5 * MINUTE) },
  ],
  [
    'set reminder for 7pm call the dentist',
    'reminder',
    { text: 'call the dentist', at: at(10, 19) },
  ],
  [
    'create a reminder for tomorrow at 9am to send the invoice',
    'reminder',
    { text: 'send the invoice', at: at(11, 9) },
  ],
  ['reminder in 5 minutes to stretch', 'reminder', { text: 'stretch', at: inMs(5 * MINUTE) }],
  [
    'remind me to buy 2 liters of milk at 6pm',
    'reminder',
    { text: 'buy 2 liters of milk', at: at(10, 18) },
  ],
  [
    'remind me to call mom 10 minutes from now',
    'reminder',
    { text: 'call mom', at: inMs(10 * MINUTE) },
  ],
];

const REMINDER_TYPOS: Case[] = [
  ['remnd me in 5 minutes to call', 'reminder', { text: 'call', at: inMs(5 * MINUTE) }],
  ['remidn me in 5 minutes to call', 'reminder', { text: 'call', at: inMs(5 * MINUTE) }],
  ['rmind me in 5 minutes to call', 'reminder', { text: 'call', at: inMs(5 * MINUTE) }],
  ['set a remindr for 6 pm to cook', 'reminder', { text: 'cook', at: at(10, 18) }],
];

const REMINDER_PROBLEMS: Case[] = [
  ['remind me', 'reminder', { problem: 'missing-text', at: null }],
  ['remind me tomorrow', 'reminder', { problem: 'missing-text', at: null, day: 'tomorrow' }],
  [
    'remind me to call mom tonight',
    'reminder',
    { problem: 'missing-time', text: 'call mom', day: 'tonight' },
  ],
  [
    'remind me tomorrow to call mom',
    'reminder',
    { problem: 'missing-time', text: 'call mom', day: 'tomorrow' },
  ],
  ['set an alarm for tomorrow', 'alarm', { problem: 'missing-time', day: 'tomorrow' }],
  ['set a reminder', 'reminder', { problem: 'missing-text', at: null }],
  ['remind me in 5 minutes', 'reminder', { problem: 'missing-text', at: inMs(5 * MINUTE) }],
  ['remind me to call mom', 'reminder', { problem: 'missing-time', text: 'call mom' }],
  ['show my reminders', 'reminder', { action: 'list' }],
  ['cancel my reminder', 'reminder', { action: 'cancel', target: { kind: 'latest' } }],
  ['delete all reminders', 'reminder', { action: 'cancel', target: { kind: 'all' } }],
];

const ALARM_CASES: Case[] = [
  ['set an alarm for 7 am', 'alarm', { at: at(11, 7) }],
  ['wake me up at 6:30', 'alarm', { at: at(11, 6, 30) }],
  ['alarm at 07:15', 'alarm', { at: at(11, 7, 15) }],
  ['alarm for 7:30 pm', 'alarm', { at: at(10, 19, 30) }],
  ['set an alarm for tomorrow at 8', 'alarm', { at: at(11, 8) }],
  ['set alarm 6 am', 'alarm', { at: at(11, 6) }],
  ['set an alarm for 6', 'alarm', { at: at(11, 6) }],
  ['set an alarm for 6:30 am tomorrow', 'alarm', { at: at(11, 6, 30) }],
  ['wake me up tomorrow at 7', 'alarm', { at: at(11, 7) }],
  ['wake me up in 8 hours', 'alarm', { at: inMs(8 * HOUR) }],
  ['set an alarm in 10 minutes', 'alarm', { at: inMs(10 * MINUTE) }],
  ['set an alarm for 10 minutes', 'alarm', { at: inMs(10 * MINUTE) }],
  ['set an alarm for seven thirty', 'alarm', { at: at(11, 7, 30) }],
  ['alarm at half past six', 'alarm', { at: at(11, 6, 30) }],
  ['set an alarm for noon', 'alarm', { at: at(11, 12) }],
  ['set a 7 am alarm', 'alarm', { at: at(11, 7) }],
  ['7 am alarm', 'alarm', { at: at(11, 7) }],
  ['set up an alarm for 6 am', 'alarm', { at: at(11, 6) }],
  ['set an alarm for 7 am every day', 'alarm', { at: at(11, 7), repeating: true }],
  ['set an alram for 7 am', 'alarm', { at: at(11, 7) }],
  ['set an alarm', 'alarm', { problem: 'missing-time' }],
  ['wake me up', 'alarm', { problem: 'missing-time' }],
  ['show my alarms', 'alarm', { action: 'list' }],
  ['what alarms do i have', 'alarm', { action: 'list' }],
  ['cancel my alarm', 'alarm', { action: 'cancel', target: { kind: 'latest' } }],
  ['turn off my alarm', 'alarm', { action: 'cancel', target: { kind: 'latest' } }],
  [
    'cancel my 7 am alarm',
    'alarm',
    { action: 'cancel', target: { kind: 'clock', minuteOfDay: 420 } },
  ],
];

const NOTES_CASES: Case[] = [
  ['take a note buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  ['note buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  ['make a note: call the dentist', 'notes', { action: 'add', text: 'call the dentist' }],
  ['write down pick up parcel', 'notes', { action: 'add', text: 'pick up parcel' }],
  ['add a note remember passport', 'notes', { action: 'add', text: 'remember passport' }],
  ['take note buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  ['take a quick note: call mom', 'notes', { action: 'add', text: 'call mom' }],
  ['make a note to self buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  ['note to self: buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  [
    'note that the wifi password is abc123',
    'notes',
    { action: 'add', text: 'the wifi password is abc123' },
  ],
  ['add buy milk to my notes', 'notes', { action: 'add', text: 'buy milk' }],
  ['write this down: abc', 'notes', { action: 'add', text: 'abc' }],
  ['jot down: call mom', 'notes', { action: 'add', text: 'call mom' }],
  ['new note: ideas for the party', 'notes', { action: 'add', text: 'ideas for the party' }],
  ['create a note buy milk and eggs', 'notes', { action: 'add', text: 'buy milk and eggs' }],
  ['write a note to call the dentist', 'notes', { action: 'add', text: 'call the dentist' }],
  [
    'Take a note: Call Dr. Smith about the Q3 numbers',
    'notes',
    { action: 'add', text: 'Call Dr. Smith about the Q3 numbers' },
  ],
  ['tak a note buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  ['taek a note buy milk', 'notes', { action: 'add', text: 'buy milk' }],
  ['take a note', 'notes', { action: 'add', text: '' }],
  ['show my notes', 'notes', { action: 'list' }],
  ['list my notes', 'notes', { action: 'list' }],
  ['what are my notes', 'notes', { action: 'list' }],
  ['show me my notes', 'notes', { action: 'list' }],
  ['read my notes', 'notes', { action: 'list' }],
  ['what notes do i have', 'notes', { action: 'list' }],
  ['notes', 'notes', { action: 'list' }],
  ['list all notes', 'notes', { action: 'list' }],
  ['search notes for milk', 'notes', { action: 'list', query: 'milk' }],
  ['find notes about project', 'notes', { action: 'list', query: 'project' }],
  ['search my notes for dentist', 'notes', { action: 'list', query: 'dentist' }],
  ['do i have any notes about milk', 'notes', { action: 'list', query: 'milk' }],
  ['find milk in my notes', 'notes', { action: 'list', query: 'milk' }],
  ['show notes about the project', 'notes', { action: 'list', query: 'project' }],
  ['delete last note', 'notes', { action: 'delete-last' }],
  ['delete my last note', 'notes', { action: 'delete-last' }],
  ['remove the last note', 'notes', { action: 'delete-last' }],
  ['erase my latest note', 'notes', { action: 'delete-last' }],
  ['undo last note', 'notes', { action: 'delete-last' }],
  ['clear all my notes', 'notes', { action: 'clear', confirmed: false }],
  ['delete all notes', 'notes', { action: 'clear', confirmed: false }],
  ['wipe my notes', 'notes', { action: 'clear', confirmed: false }],
  ['confirm delete all notes', 'notes', { action: 'clear', confirmed: true }],
];

const COPY_CASES: Case[] = [
  ['copy that', 'copy-that', {}],
  ['copy this', 'copy-that', {}],
  ['copy the answer', 'copy-that', {}],
  ['copy last answer', 'copy-that', {}],
  ['copy it', 'copy-that', {}],
  ['copy the result', 'copy-that', {}],
  ['copy that to clipboard', 'copy-that', {}],
  ['copy to the clipboard', 'copy-that', {}],
  ['copy the last response', 'copy-that', {}],
  ['copy', 'copy-that', {}],
  ['cpoy that', 'copy-that', {}],
  ['Hey Beekeeper, copy that please', 'copy-that', {}],
];

/** What the offline speech recogniser produces: lower case words, spelled-out numbers, "a m". */
const SPOKEN_CASES: Case[] = [
  ['set a timer for one hour and thirty minutes', 'timer', { durationMs: 90 * MINUTE }],
  ['set a timer for an hour and a half', 'timer', { durationMs: 90 * MINUTE }],
  ['set a timer for twenty five minutes', 'timer', { durationMs: 25 * MINUTE }],
  [
    'remind me in twenty minutes to call mom',
    'reminder',
    { text: 'call mom', at: inMs(20 * MINUTE) },
  ],
  [
    'remind me at three thirty p m to submit the report',
    'reminder',
    { text: 'submit the report', at: at(11, 15, 30) },
  ],
  [
    'remind me at seven forty five in the evening to take the pill',
    'reminder',
    { text: 'take the pill', at: at(10, 19, 45) },
  ],
  ['remind me to call mom at nine', 'reminder', { text: 'call mom', at: at(10, 21) }],
  ['set an alarm for six thirty a m', 'alarm', { at: at(11, 6, 30) }],
  ['wake me up at six forty five', 'alarm', { at: at(11, 6, 45) }],
  ['wake me up at five thirty tomorrow', 'alarm', { at: at(11, 5, 30) }],
  ['set an alarm for seven fifteen', 'alarm', { at: at(11, 7, 15) }],
];

const COLLISIONS: Array<[string, string]> = [
  ['remind me to set a timer for 5 minutes', 'reminder'],
  ['remind me to take a note', 'reminder'],
  ['remind me to copy that', 'reminder'],
  ['set a reminder to set an alarm for 7', 'reminder'],
  ['take a note remind me to call mom', 'notes'],
  ['take a note set a timer for 5 minutes', 'notes'],
  ['write down set an alarm for 7 am', 'notes'],
  ['set a timer for 5 minutes to remind me', 'timer'],
  ['set an alarm for 10 minutes', 'alarm'],
  ['wake me up in 8 hours', 'alarm'],
  ['cancel my alarm', 'alarm'],
  ['cancel my timer', 'timer'],
  ['cancel my reminder', 'reminder'],
];

const NEGATIVES = [
  // other productivity-adjacent wording that is not a command
  'what is a timer',
  'timer settings',
  'timer app',
  'open timer',
  'close the timer app',
  'i need more time',
  'how much time do i have left today',
  'how long does it take to fly to tokyo',
  'the timer on my oven is broken',
  'my alarm clock is broken',
  'what is a good reminder app',
  'reminders app',
  'remember to buy milk',
  'remind john to call me',
  'remind em in 5 minutes',
  'remind',
  'i need a reminder',
  'stop the alarm',
  'wake word',
  'wake word settings',
  'what is wake word',
  'wake up the screen',
  'wake on lan',
  'take a break',
  'take a photo',
  'write an email',
  'write a poem about cats',
  'add milk to the shopping list',
  'delete the note about milk',
  'open the notes app',
  'search notes app',
  'notepad',
  'noted',
  'copy file',
  'copy the weather',
  'copy and paste that',
  'copy and paste',
  'copy of the file',
  // commands owned by other groups
  'what time is it',
  "what's the date",
  'what day is it',
  'open notepad',
  'open vs code',
  'launch spotify',
  'start spotify',
  'close chrome',
  'search for cats',
  'google weather in paris',
  'play despacito on youtube',
  'open youtube.com',
  'weather in paris',
  'will it rain tomorrow',
  'what is the weather',
  'battery status',
  'system info',
  'calculate 15% of 2400',
  'convert 5 km to miles',
  'define serendipity',
  'volume up',
  'set volume to 50',
  'set the volume to 5',
  'turn up the volume',
  'mute',
  'set brightness to 70',
  'take a screenshot',
  'lock my pc',
  'open wifi settings',
  'empty recycle bin',
  'shutdown',
  'restart my pc',
  'toggle dark mode',
  'circle to search',
  'open settings',
  'what can you do',
  'stop',
  'cancel',
  'never mind',
  'stop listening',
  'stop the music',
  'turn off wifi',
  'turn off the lights',
  'set the oven to 350',
  'set a goal for this week',
  'set up wifi',
  'clear history',
  'clear the screen',
  'clear browsing history',
  'delete file',
  'delete the file report.txt',
  'remove the background',
  'show me the weather',
  'show my battery',
  'list files',
  'tell me a joke',
  'who is the president',
  'how are you',
  '',
  'banana',
];

function expectCases(cases: Case[]): void {
  it.each(cases)('%s', (text, id, slots) => {
    const winner = parse(text);
    expect(winner?.command.id).toBe(id);
    expect(winner?.slots).toMatchObject(slots);
  });
}

describe('timer phrases', () => {
  expectCases(TIMER_CASES);
  describe('typos', () => {
    expectCases(TIMER_TYPOS);
  });
});

describe('reminder phrases', () => {
  expectCases(REMINDER_CASES);
  describe('typos', () => {
    expectCases(REMINDER_TYPOS);
  });
  describe('incomplete requests and management', () => {
    expectCases(REMINDER_PROBLEMS);
  });
});

describe('alarm phrases', () => {
  expectCases(ALARM_CASES);
});

describe('notes phrases', () => {
  expectCases(NOTES_CASES);
});

describe('copy that phrases', () => {
  expectCases(COPY_CASES);
});

describe('phrases as the speech recogniser spells them', () => {
  expectCases(SPOKEN_CASES);
});

describe('collisions between the productivity commands', () => {
  it.each(COLLISIONS)('%s is handled by %s', (text, id) => {
    expect(parse(text)?.command.id).toBe(id);
  });
});

describe('things that are not productivity commands', () => {
  it.each(NEGATIVES)('ignores %j', (text) => {
    expect(parse(text)).toBeNull();
  });
});

describe('scoring', () => {
  it('is more confident about exact phrases than about typos', () => {
    const exact = parse('set a timer for 5 minutes')?.score ?? 0;
    const typo = parse('set a tiemr for 5 minutes')?.score ?? 0;
    expect(exact).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThanOrEqual(0.8);
    expect(parse('remind me in 5 minutes to call')?.score).toBeGreaterThan(
      parse('remnd me in 5 minutes to call')?.score ?? 1,
    );
  });

  it('keeps every score within 0..1 and rates incomplete requests lower', () => {
    const complete = parse('remind me in 10 minutes to call mom')?.score ?? 0;
    const incomplete = parse('remind me to call mom')?.score ?? 1;
    expect(complete).toBeLessThanOrEqual(1);
    expect(incomplete).toBeLessThan(complete);
    expect(parse('confirm delete all notes')?.score).toBe(1);
  });
});

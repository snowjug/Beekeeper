import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@shared/cards';
import {
  MAX_HISTORY_ENTRIES,
  createHistoryService,
  emptyHistoryFile,
  openHistoryStore,
  parseHistoryFile,
} from '@main/services/history';
import { memoryStore } from '../commands/productivity/fakes';

type NewEntry = Omit<HistoryEntry, 'id'>;

function entry(text: string, overrides: Partial<NewEntry> = {}): NewEntry {
  return { at: 1_000, text, source: 'text', commandId: null, summary: '', ...overrides };
}

function setup() {
  let counter = 0;
  const history = createHistoryService({
    store: memoryStore(emptyHistoryFile),
    now: () => 99_000,
    newId: () => {
      counter += 1;
      return `h${counter}`;
    },
  });
  return history;
}

describe('history service', () => {
  it('adds entries and lists them newest first', () => {
    const history = setup();
    expect(
      history.add(entry('what time is it', { commandId: 'time', summary: '3:42 PM' })),
    ).toEqual({
      id: 'h1',
      at: 1_000,
      text: 'what time is it',
      source: 'text',
      commandId: 'time',
      summary: '3:42 PM',
    });
    history.add(entry('open notepad', { at: 2_000, source: 'voice' }));
    expect(history.list().map((item) => item.text)).toEqual(['open notepad', 'what time is it']);
  });

  it('trims, clamps and falls back to the clock when the time is invalid', () => {
    const history = setup();
    const added = history.add(
      entry('  hello  ', { at: Number.NaN, summary: `  ${'s'.repeat(500)} ` }),
    );
    expect(added.text).toBe('hello');
    expect(added.at).toBe(99_000);
    expect(added.summary).toHaveLength(300);
    expect(history.add(entry('y'.repeat(5_000))).text).toHaveLength(1_000);
  });

  it('keeps the last 200 interactions', () => {
    const history = setup();
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 5; index += 1) {
      history.add(entry(`question ${index}`));
    }
    const all = history.list();
    expect(all).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(all[0]?.text).toBe(`question ${MAX_HISTORY_ENTRIES + 4}`);
    expect(all[all.length - 1]?.text).toBe('question 5');
  });

  it('searches text and summary case-insensitively, requiring every word', () => {
    const history = setup();
    history.add(entry('Set a timer for 5 minutes', { summary: 'Timer set' }));
    history.add(entry('weather in Paris', { summary: 'Sunny, 21 degrees' }));
    history.add(entry('what is the weather', { summary: 'Rain tomorrow' }));

    expect(history.list('WEATHER').map((item) => item.text)).toEqual([
      'what is the weather',
      'weather in Paris',
    ]);
    expect(history.list('sunny paris')).toHaveLength(1);
    expect(history.list('timer minutes')).toHaveLength(1);
    expect(history.list('weather timer')).toEqual([]);
    expect(history.list('')).toHaveLength(3);
  });

  it('applies the limit', () => {
    const history = setup();
    for (let index = 0; index < 5; index += 1) history.add(entry(`q${index}`));
    expect(history.list(undefined, 2).map((item) => item.text)).toEqual(['q4', 'q3']);
    expect(history.list(undefined, 0)).toEqual([]);
    expect(history.list(undefined, -1)).toEqual([]);
  });

  it('clears the history and reports how many entries were removed', () => {
    const history = setup();
    history.add(entry('a'));
    history.add(entry('b'));
    expect(history.clear()).toBe(2);
    expect(history.clear()).toBe(0);
    expect(history.list()).toEqual([]);
  });

  it('hands out copies', () => {
    const history = setup();
    history.add(entry('original'));
    const [first] = history.list();
    if (first === undefined) throw new Error('expected an entry');
    first.text = 'tampered';
    expect(history.list()[0]?.text).toBe('original');
  });
});

describe('history recall (Up arrow)', () => {
  it('walks back through the most recent user texts', () => {
    const history = setup();
    ['one', 'two', 'three'].forEach((text) => history.add(entry(text)));
    expect([0, 1, 2, 3].map((offset) => history.recall(offset))).toEqual([
      'three',
      'two',
      'one',
      null,
    ]);
  });

  it('collapses consecutive repeats but not distant ones', () => {
    const history = setup();
    ['a', 'a', 'b', 'a', 'a', 'a'].forEach((text) => history.add(entry(text)));
    expect([0, 1, 2, 3].map((offset) => history.recall(offset))).toEqual(['a', 'b', 'a', null]);
  });

  it('skips blank texts and treats different spellings as different lines', () => {
    const history = setup();
    ['Hello', '   ', 'hello', ''].forEach((text) => history.add(entry(text)));
    expect([0, 1, 2].map((offset) => history.recall(offset))).toEqual(['hello', 'Hello', null]);
  });

  it('rejects offsets that make no sense', () => {
    const history = setup();
    history.add(entry('one'));
    expect(history.recall(-1)).toBeNull();
    expect(history.recall(0.5)).toBeNull();
    expect(history.recall(Number.NaN)).toBeNull();
    expect(setup().recall(0)).toBeNull();
  });
});

describe('history persistence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beekeeper-history-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is stored as JSON and reloaded', async () => {
    const filePath = join(dir, 'history.json');
    const store = openHistoryStore(filePath);
    createHistoryService({ store }).add(entry('open notepad', { commandId: 'open-app' }));
    await store.flush();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      version: 1,
      entries: [{ text: 'open notepad', commandId: 'open-app' }],
    });
    const reloaded = createHistoryService({ store: openHistoryStore(filePath) });
    expect(reloaded.list()[0]?.text).toBe('open notepad');
    expect(reloaded.recall(0)).toBe('open notepad');
  });
});

describe('parseHistoryFile', () => {
  const good = { id: 'a', at: 1, text: 'hi', source: 'voice', commandId: null, summary: 's' };

  it('keeps valid entries and drops damaged ones', () => {
    const parsed = parseHistoryFile({
      version: 1,
      entries: [
        good,
        { ...good, id: '' },
        { ...good, id: 'b', source: 'fax' },
        { ...good, id: 'c', at: 'now' },
        { ...good, id: 'd', commandId: 7 },
        { ...good, id: 'e', text: 5 },
        { ...good, id: 'f', commandId: 'timer', text: 'x'.repeat(2_000), summary: 'y'.repeat(900) },
        'junk',
      ],
    });
    expect(parsed.entries.map((item) => item.id)).toEqual(['a', 'f']);
    expect(parsed.entries[1]?.text).toHaveLength(1_000);
    expect(parsed.entries[1]?.summary).toHaveLength(300);
  });

  it('limits the number of entries', () => {
    const entries = Array.from({ length: MAX_HISTORY_ENTRIES + 10 }, (_, index) => ({
      ...good,
      id: `h${index}`,
    }));
    expect(parseHistoryFile({ version: 1, entries }).entries).toHaveLength(MAX_HISTORY_ENTRIES);
  });

  it('rejects files that are not history documents', () => {
    expect(() => parseHistoryFile(null)).toThrow();
    expect(() => parseHistoryFile({ version: 2, entries: [] })).toThrow();
    expect(() => parseHistoryFile({ version: 1, entries: {} })).toThrow();
  });
});

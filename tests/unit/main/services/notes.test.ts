import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  createNotesService,
  emptyNotesFile,
  openNotesStore,
  parseNotesFile,
} from '@main/services/notes';
import { memoryStore } from '../commands/productivity/fakes';

function setup() {
  let counter = 0;
  let time = 1_000;
  const store = memoryStore(emptyNotesFile);
  const notes = createNotesService({
    store,
    now: () => time,
    newId: () => {
      counter += 1;
      return `n${counter}`;
    },
  });
  return {
    notes,
    store,
    tick: (ms = 1_000) => {
      time += ms;
    },
  };
}

describe('notes service', () => {
  it('adds notes and lists them newest first', () => {
    const { notes, tick } = setup();
    expect(notes.add('buy milk')).toEqual({ id: 'n1', text: 'buy milk', createdAt: 1_000 });
    tick();
    notes.add('call the dentist');
    tick();
    notes.add('pick up parcel');

    const { notes: listed, total } = notes.list();
    expect(listed.map((note) => note.text)).toEqual([
      'pick up parcel',
      'call the dentist',
      'buy milk',
    ]);
    expect(total).toBe(3);
  });

  it('trims text and rejects empty notes', () => {
    const { notes } = setup();
    expect(notes.add('  spaced out \n').text).toBe('spaced out');
    expect(() => notes.add('   ')).toThrow(RangeError);
    expect(notes.list().total).toBe(1);
  });

  it('caps the note length', () => {
    const { notes } = setup();
    expect(notes.add('x'.repeat(MAX_NOTE_LENGTH + 500)).text).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('keeps at most MAX_NOTES notes and drops the oldest', () => {
    const { notes } = setup();
    for (let index = 0; index < MAX_NOTES + 5; index += 1) notes.add(`note ${index}`);
    const { notes: listed, total } = notes.list();
    expect(total).toBe(MAX_NOTES);
    expect(listed[0]?.text).toBe(`note ${MAX_NOTES + 4}`);
    expect(listed[MAX_NOTES - 1]?.text).toBe('note 5');
  });

  describe('search', () => {
    function seeded() {
      const harness = setup();
      harness.notes.add('Buy MILK and eggs');
      harness.notes.add('Project kickoff on Monday');
      harness.notes.add('milk the cow? no - project plan');
      return harness.notes;
    }

    it('matches case-insensitively on words and substrings', () => {
      const notes = seeded();
      expect(notes.list('milk').notes.map((note) => note.text)).toEqual([
        'milk the cow? no - project plan',
        'Buy MILK and eggs',
      ]);
      expect(notes.list('PROJ').total).toBe(2);
      expect(notes.list('mil').total).toBe(2);
    });

    it('requires every word of the query', () => {
      const notes = seeded();
      expect(notes.list('milk project').notes.map((note) => note.text)).toEqual([
        'milk the cow? no - project plan',
      ]);
      expect(notes.list('milk dentist')).toEqual({ notes: [], total: 0 });
    });

    it('treats an empty query as "all notes"', () => {
      const notes = seeded();
      expect(notes.list('   ').total).toBe(3);
      expect(notes.list(undefined).total).toBe(3);
    });

    it('applies the limit but reports the number of matches', () => {
      const notes = seeded();
      const limited = notes.list('project', 1);
      expect(limited.notes).toHaveLength(1);
      expect(limited.total).toBe(2);
      expect(notes.list(undefined, 0).notes).toEqual([]);
      expect(notes.list(undefined, -3).notes).toEqual([]);
    });
  });

  it('hands out copies', () => {
    const { notes } = setup();
    notes.add('original');
    const [first] = notes.list().notes;
    if (first === undefined) throw new Error('expected a note');
    first.text = 'tampered';
    expect(notes.list().notes[0]?.text).toBe('original');
  });

  it('deletes the most recent note', () => {
    const { notes } = setup();
    expect(notes.deleteLast()).toBeNull();
    notes.add('first');
    notes.add('second');
    expect(notes.deleteLast()).toMatchObject({ text: 'second' });
    expect(notes.list().notes.map((note) => note.text)).toEqual(['first']);
    expect(notes.deleteLast()).toMatchObject({ text: 'first' });
    expect(notes.deleteLast()).toBeNull();
  });

  it('clears all notes and reports how many were removed', () => {
    const { notes } = setup();
    notes.add('a');
    notes.add('b');
    expect(notes.clear()).toBe(2);
    expect(notes.clear()).toBe(0);
    expect(notes.list()).toEqual({ notes: [], total: 0 });
  });
});

describe('notes persistence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beekeeper-notes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is stored as JSON and reloaded', async () => {
    const filePath = join(dir, 'notes.json');
    const store = openNotesStore(filePath);
    const notes = createNotesService({ store });
    notes.add('buy milk');
    notes.add('call mom');
    await store.flush();
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      version: 1,
      notes: [{ text: 'call mom' }, { text: 'buy milk' }],
    });

    const reloaded = createNotesService({ store: openNotesStore(filePath) });
    expect(reloaded.list().notes.map((note) => note.text)).toEqual(['call mom', 'buy milk']);
    expect(reloaded.list('milk').total).toBe(1);
  });
});

describe('parseNotesFile', () => {
  it('keeps valid notes, drops damaged ones and clamps sizes', () => {
    const parsed = parseNotesFile({
      version: 1,
      notes: [
        { id: 'a', text: 'ok', createdAt: 1 },
        { id: 'b', text: '   ', createdAt: 2 },
        { id: '', text: 'no id', createdAt: 3 },
        { id: 'c', text: 'bad time', createdAt: 'yesterday' },
        { id: 'd', text: 'x'.repeat(MAX_NOTE_LENGTH + 10), createdAt: 4 },
        42,
        null,
      ],
    });
    expect(parsed.notes.map((note) => note.id)).toEqual(['a', 'd']);
    expect(parsed.notes[1]?.text).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('limits the number of notes', () => {
    const notes = Array.from({ length: MAX_NOTES + 20 }, (_, index) => ({
      id: `n${index}`,
      text: 'x',
      createdAt: index,
    }));
    expect(parseNotesFile({ version: 1, notes }).notes).toHaveLength(MAX_NOTES);
  });

  it('rejects files that are not notes documents', () => {
    expect(() => parseNotesFile('text')).toThrow();
    expect(() => parseNotesFile({ version: 3, notes: [] })).toThrow();
    expect(() => parseNotesFile({ version: 1 })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import type { NotesCard, StatusCard } from '@shared/cards';
import { notesCommand } from '@main/commands/productivity/notes';
import { normalizeInput } from '@main/commands/text';
import { MAX_NOTE_LENGTH } from '@main/services/notes';
import { NOW, createHarness, execute, turnAfter, type Harness } from './fakes';

function statusOf(card: unknown): StatusCard {
  return card as StatusCard;
}

function seed(h: Harness, ...texts: string[]): void {
  for (const text of texts) h.notes.add(text);
}

describe('adding notes', () => {
  it('saves the note and confirms it', async () => {
    const h = createHarness();
    const result = await execute(h, notesCommand, 'take a note buy milk');

    expect(result.speech).toBe('Note saved');
    expect(result.autoCloseMs).toBe(2500);
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'note',
      title: 'Note saved',
      detail: 'buy milk',
      copyText: 'buy milk',
    });
    expect(h.notes.list().notes).toEqual([
      { id: 'n1', text: 'buy milk', createdAt: NOW.getTime() },
    ]);
  });

  it('keeps the capitals the user typed', async () => {
    const h = createHarness();
    await execute(h, notesCommand, 'Take a note: Call Dr. Smith about the Q3 numbers');
    expect(h.notes.list().notes[0]?.text).toBe('Call Dr. Smith about the Q3 numbers');
  });

  it('asks what to write and takes the next message as the note', async () => {
    const h = createHarness();
    const question = await execute(h, notesCommand, 'take a note');
    expect(statusOf(question.cards[0]).title).toBe('What should the note say?');
    expect(question.pin).toBe(true);
    expect(question.context).toEqual({ awaiting: 'note-text' });
    expect(h.notes.list().total).toBe(0);

    await execute(h, notesCommand, 'Pick up the parcel', [turnAfter(h, 'notes', question)]);
    expect(h.notes.list().notes[0]?.text).toBe('Pick up the parcel');
  });

  it('does not take stray text as a note when it did not ask', () => {
    const h = createHarness();
    expect(notesCommand.match(normalizeInput('pick up the parcel'), h.parseContext())).toBeNull();
  });

  it('accepts a note of the maximum length and refuses a longer one', async () => {
    const h = createHarness();
    const long = await execute(h, notesCommand, `take a note ${'x'.repeat(MAX_NOTE_LENGTH + 1)}`);
    expect(statusOf(long.cards[0])).toMatchObject({
      tone: 'warning',
      title: 'That note is too long',
    });
    expect(h.notes.list().total).toBe(0);

    await execute(h, notesCommand, `take a note ${'x'.repeat(MAX_NOTE_LENGTH)}`);
    expect(h.notes.list().notes[0]?.text).toHaveLength(MAX_NOTE_LENGTH);
  });
});

describe('listing and searching notes', () => {
  it('shows a notes card, newest first, with a copyable text', async () => {
    const h = createHarness();
    seed(h, 'buy milk', 'call the dentist', 'pick up parcel');
    const result = await execute(h, notesCommand, 'show my notes');

    const card = result.cards[0] as NotesCard;
    expect(card).toMatchObject({ kind: 'notes', title: 'Your notes', total: 3 });
    expect(card.notes.map((note) => note.text)).toEqual([
      'pick up parcel',
      'call the dentist',
      'buy milk',
    ]);
    expect(card.query).toBeUndefined();
    expect(card.copyText).toBe('- pick up parcel\n- call the dentist\n- buy milk');
    expect(result.speech).toBe('You have 3 notes. The latest says: pick up parcel');
    expect(result.pin).toBe(true);
  });

  it('reads a single note and shortens a long one for speech', async () => {
    const h = createHarness();
    seed(h, 'buy milk');
    expect((await execute(h, notesCommand, 'list my notes')).speech).toBe(
      'You have one note: buy milk',
    );

    seed(h, `${'long '.repeat(60)}end`);
    const speech = (await execute(h, notesCommand, 'list my notes')).speech ?? '';
    expect(speech.startsWith('You have 2 notes. The latest says: long long')).toBe(true);
    expect(speech.endsWith('…')).toBe(true);
    expect(speech.length).toBeLessThan(200);
  });

  it('shows at most 20 notes but reports the total', async () => {
    const h = createHarness();
    for (let index = 0; index < 25; index += 1) seed(h, `note ${index}`);
    const card = (await execute(h, notesCommand, 'show my notes')).cards[0] as NotesCard;
    expect(card.notes).toHaveLength(20);
    expect(card.total).toBe(25);
  });

  it('searches by words and says how many matched', async () => {
    const h = createHarness();
    seed(h, 'Buy MILK', 'Project plan', 'milk the project budget');
    const result = await execute(h, notesCommand, 'search notes for milk');

    const card = result.cards[0] as NotesCard;
    expect(card).toMatchObject({ title: 'Notes about "milk"', query: 'milk', total: 2 });
    expect(card.notes.map((note) => note.text)).toEqual(['milk the project budget', 'Buy MILK']);
    expect(result.speech).toBe('I found 2 notes about milk.');
    expect(
      ((await execute(h, notesCommand, 'find milk in my notes')).cards[0] as NotesCard).total,
    ).toBe(2);
  });

  it('says so when nothing is saved or found', async () => {
    const h = createHarness();
    const empty = await execute(h, notesCommand, 'show my notes');
    expect(statusOf(empty.cards[0])).toMatchObject({ title: 'No notes yet' });
    expect(empty.speech).toBe("You don't have any notes yet.");

    seed(h, 'buy milk');
    const none = await execute(h, notesCommand, 'search notes for dentist');
    expect(statusOf(none.cards[0]).title).toBe('No notes about "dentist"');
    expect(none.speech).toBe('I found no notes about dentist.');
  });
});

describe('deleting notes', () => {
  it('deletes the most recent note and offers to undo', async () => {
    const h = createHarness();
    seed(h, 'buy milk', 'call the dentist');
    const result = await execute(h, notesCommand, 'delete my last note');

    expect(result.speech).toBe('Deleted your last note');
    expect(statusOf(result.cards[0])).toMatchObject({
      tone: 'success',
      icon: 'trash',
      title: 'Deleted your last note',
      detail: 'call the dentist',
      actions: [{ type: 'command', label: 'Undo', text: 'take a note call the dentist' }],
    });
    expect(h.notes.list().notes.map((note) => note.text)).toEqual(['buy milk']);

    const undo = statusOf(result.cards[0]).actions?.[0];
    if (undo?.type !== 'command') throw new Error('expected a command action');
    await execute(h, notesCommand, undo.text);
    expect(h.notes.list().notes.map((note) => note.text)).toEqual(['call the dentist', 'buy milk']);
  });

  it('offers no undo for very long notes', async () => {
    const h = createHarness();
    seed(h, 'x'.repeat(400));
    const result = await execute(h, notesCommand, 'delete last note');
    expect(statusOf(result.cards[0]).actions).toBeUndefined();
  });

  it('is friendly when there is nothing to delete', async () => {
    const h = createHarness();
    const result = await execute(h, notesCommand, 'delete last note');
    expect(statusOf(result.cards[0])).toMatchObject({
      tone: 'neutral',
      title: 'No notes to delete',
    });
    expect(result.speech).toBe("You don't have any notes to delete.");
  });
});

describe('clearing all notes', () => {
  it('asks first and only deletes after the confirmation phrase', async () => {
    const h = createHarness();
    seed(h, 'a', 'b', 'c');
    const ask = await execute(h, notesCommand, 'clear all my notes');

    const card = statusOf(ask.cards[0]);
    expect(card).toMatchObject({
      tone: 'warning',
      title: 'Delete all 3 notes?',
      detail: "This can't be undone.",
    });
    expect(card.actions).toEqual([
      { type: 'command', label: 'Yes, delete all notes', text: 'confirm delete all notes' },
    ]);
    expect(ask.pin).toBe(true);
    expect(ask.context).toEqual({ awaiting: 'notes-clear' });
    expect(h.notes.list().total).toBe(3);

    const action = card.actions?.[0];
    if (action?.type !== 'command') throw new Error('expected a command action');
    const done = await execute(h, notesCommand, action.text);
    expect(statusOf(done.cards[0])).toMatchObject({
      tone: 'success',
      title: 'Deleted all 3 notes',
    });
    expect(done.speech).toBe('Deleted all 3 notes');
    expect(h.notes.list().total).toBe(0);
  });

  it('accepts "yes" right after the question, but not out of the blue', async () => {
    const h = createHarness();
    seed(h, 'only note');
    const ask = await execute(h, notesCommand, 'delete all notes');
    expect(statusOf(ask.cards[0]).title).toBe('Delete your note?');

    expect(notesCommand.match(normalizeInput('yes'), h.parseContext())).toBeNull();
    expect(
      notesCommand.match(normalizeInput('banana'), h.parseContext([turnAfter(h, 'notes', ask)])),
    ).toBeNull();
    const done = await execute(h, notesCommand, 'yes', [turnAfter(h, 'notes', ask)]);
    expect(done.speech).toBe('Deleted your note');
    expect(h.notes.list().total).toBe(0);
  });

  it('has nothing to ask about when there are no notes', async () => {
    const h = createHarness();
    for (const phrase of ['clear all my notes', 'confirm delete all notes']) {
      const result = await execute(h, notesCommand, phrase);
      expect(statusOf(result.cards[0]).title).toBe('No notes to delete');
    }
  });
});

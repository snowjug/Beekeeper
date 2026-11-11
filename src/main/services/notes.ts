import { randomUUID } from 'node:crypto';
import type { NoteItem } from '@shared/cards';
import type { Logger } from '@shared/logger';
import type { NotesService } from '../commands/types';
import { JsonStore } from './jsonStore';

export const MAX_NOTE_LENGTH = 2000;
export const MAX_NOTES = 1000;

export interface NotesFile {
  version: 1;
  /** Newest first. */
  notes: NoteItem[];
}

export function emptyNotesFile(): NotesFile {
  return { version: 1, notes: [] };
}

function toNote(value: unknown): NoteItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    item.id === '' ||
    typeof item.text !== 'string' ||
    item.text.trim() === '' ||
    typeof item.createdAt !== 'number' ||
    !Number.isFinite(item.createdAt)
  ) {
    return null;
  }
  return { id: item.id, text: item.text.slice(0, MAX_NOTE_LENGTH), createdAt: item.createdAt };
}

/** Validator for JsonStore: keeps readable notes, drops damaged ones, rejects foreign files. */
export function parseNotesFile(raw: unknown): NotesFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('Notes file is not an object');
  const file = raw as { version?: unknown; notes?: unknown };
  if (file.version !== 1 || !Array.isArray(file.notes)) throw new Error('Unsupported notes file');
  const notes: NoteItem[] = [];
  for (const entry of file.notes as unknown[]) {
    const note = toNote(entry);
    if (note !== null) notes.push(note);
  }
  return { version: 1, notes: notes.slice(0, MAX_NOTES) };
}

/** Opens (or creates) the persistent notes document at `filePath`. */
export function openNotesStore(filePath: string, logger?: Logger): JsonStore<NotesFile> {
  return new JsonStore<NotesFile>({
    filePath,
    defaults: emptyNotesFile,
    parse: parseNotesFile,
    logger,
  });
}

export interface NotesServiceOptions {
  store: JsonStore<NotesFile>;
  now?: () => number;
  newId?: () => string;
}

function queryWords(query: string | undefined): string[] {
  return (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Local notes: newest first, capped at MAX_NOTES, searchable by words (case-insensitive). */
export function createNotesService(options: NotesServiceOptions): NotesService {
  const { store } = options;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;

  return {
    add(text) {
      const clean = text.trim().slice(0, MAX_NOTE_LENGTH);
      if (clean === '') throw new RangeError('A note cannot be empty');
      const note: NoteItem = { id: newId(), text: clean, createdAt: now() };
      store.update((file) => ({
        ...file,
        notes: [note, ...file.notes].slice(0, MAX_NOTES),
      }));
      return { ...note };
    },

    list(query, limit) {
      const words = queryWords(query);
      const matches = store.get().notes.filter((note) => {
        const text = note.text.toLowerCase();
        return words.every((word) => text.includes(word));
      });
      const shown = limit === undefined ? matches : matches.slice(0, Math.max(0, limit));
      return { notes: shown.map((note) => ({ ...note })), total: matches.length };
    },

    deleteLast() {
      const [latest, ...rest] = store.get().notes;
      if (latest === undefined) return null;
      store.update((file) => ({ ...file, notes: rest }));
      return { ...latest };
    },

    clear() {
      const count = store.get().notes.length;
      if (count > 0) store.update((file) => ({ ...file, notes: [] }));
      return count;
    },
  };
}

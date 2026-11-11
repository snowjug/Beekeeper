import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '@shared/cards';
import type { Logger } from '@shared/logger';
import type { HistoryService } from '../commands/types';
import { JsonStore } from './jsonStore';

/** Spec 4.9: the last 200 interactions are kept. */
export const MAX_HISTORY_ENTRIES = 200;
const MAX_TEXT_LENGTH = 1000;
const MAX_SUMMARY_LENGTH = 300;

export interface HistoryFile {
  version: 1;
  /** Newest first. */
  entries: HistoryEntry[];
}

export function emptyHistoryFile(): HistoryFile {
  return { version: 1, entries: [] };
}

const SOURCES: ReadonlySet<unknown> = new Set(['text', 'voice', 'circle']);

function toEntry(value: unknown): HistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    item.id === '' ||
    typeof item.text !== 'string' ||
    typeof item.summary !== 'string' ||
    typeof item.at !== 'number' ||
    !Number.isFinite(item.at) ||
    (item.commandId !== null && typeof item.commandId !== 'string') ||
    !SOURCES.has(item.source)
  ) {
    return null;
  }
  return {
    id: item.id,
    at: item.at,
    text: item.text.slice(0, MAX_TEXT_LENGTH),
    source: item.source as HistoryEntry['source'],
    commandId: item.commandId,
    summary: item.summary.slice(0, MAX_SUMMARY_LENGTH),
  };
}

/** Validator for JsonStore: keeps readable entries, drops damaged ones, rejects foreign files. */
export function parseHistoryFile(raw: unknown): HistoryFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('History file is not an object');
  const file = raw as { version?: unknown; entries?: unknown };
  if (file.version !== 1 || !Array.isArray(file.entries))
    throw new Error('Unsupported history file');
  const entries: HistoryEntry[] = [];
  for (const candidate of file.entries as unknown[]) {
    const entry = toEntry(candidate);
    if (entry !== null) entries.push(entry);
  }
  return { version: 1, entries: entries.slice(0, MAX_HISTORY_ENTRIES) };
}

/** Opens (or creates) the persistent history document at `filePath`. */
export function openHistoryStore(filePath: string, logger?: Logger): JsonStore<HistoryFile> {
  return new JsonStore<HistoryFile>({
    filePath,
    defaults: emptyHistoryFile,
    parse: parseHistoryFile,
    logger,
  });
}

export interface HistoryServiceOptions {
  store: JsonStore<HistoryFile>;
  now?: () => number;
  newId?: () => string;
}

/** Conversation history (spec 4.9) plus the Up-arrow recall used by the text input. */
export class HistoryServiceImpl implements HistoryService {
  private readonly store: JsonStore<HistoryFile>;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: HistoryServiceOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  add(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
    const created: HistoryEntry = {
      id: this.newId(),
      at: Number.isFinite(entry.at) ? entry.at : this.now(),
      text: entry.text.trim().slice(0, MAX_TEXT_LENGTH),
      source: entry.source,
      commandId: entry.commandId,
      summary: entry.summary.trim().slice(0, MAX_SUMMARY_LENGTH),
    };
    this.store.update((file) => ({
      ...file,
      entries: [created, ...file.entries].slice(0, MAX_HISTORY_ENTRIES),
    }));
    return { ...created };
  }

  /** Newest first. Every word of `query` must appear in the text or the summary. */
  list(query?: string, limit?: number): HistoryEntry[] {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const matches = this.store.get().entries.filter((entry) => {
      const haystack = `${entry.text}\n${entry.summary}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    const shown = limit === undefined ? matches : matches.slice(0, Math.max(0, limit));
    return shown.map((entry) => ({ ...entry }));
  }

  clear(): number {
    const count = this.store.get().entries.length;
    if (count > 0) this.store.update((file) => ({ ...file, entries: [] }));
    return count;
  }

  /**
   * Up-arrow recall: the user text `offset` steps back (0 = most recent). Consecutive repeats
   * count once, so pressing Up never shows the same line twice in a row.
   */
  recall(offset: number): string | null {
    if (!Number.isInteger(offset) || offset < 0) return null;
    let seen = -1;
    let previous: string | null = null;
    for (const entry of this.store.get().entries) {
      const text = entry.text.trim();
      if (text === '' || text === previous) continue;
      previous = text;
      seen += 1;
      if (seen === offset) return text;
    }
    return null;
  }
}

export function createHistoryService(options: HistoryServiceOptions): HistoryServiceImpl {
  return new HistoryServiceImpl(options);
}

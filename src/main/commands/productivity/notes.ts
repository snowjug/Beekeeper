import type { CommandResult, NoteItem, NotesCard } from '@shared/cards';
import { matchLeadingVerb, stripArticles } from '../text';
import {
  defineCommand,
  type CommandMatch,
  type NormalizedInput,
  type ParseContext,
  type RunContext,
} from '../types';
import { MAX_NOTE_LENGTH } from '../../services/notes';
import { count, pendingQuestion, restoreCase, snippet, statusCard } from './shared';

type NotesSlots =
  | { action: 'add'; text: string }
  | { action: 'list'; query?: string }
  | { action: 'delete-last' }
  | { action: 'clear'; confirmed: boolean };

const LIST_LIMIT = 20;
/** The phrase on the "Yes, delete all notes" button; it is matched as a confirmed clear. */
const CLEAR_CONFIRMATION = 'confirm delete all notes';

const ADD_VERBS = ['take', 'make', 'add', 'create', 'write', 'save', 'jot', 'new', 'start'];
const DOWN_VERBS = ['write', 'jot', 'note', 'put', 'scribble'];
const LIST_VERBS = [
  'show',
  'list',
  'view',
  'read',
  'see',
  'display',
  'check',
  'get',
  'fetch',
  'find',
  'search',
  'look up',
  'look for',
];
const DELETE_VERBS = [
  'delete',
  'remove',
  'erase',
  'discard',
  'trash',
  'drop',
  'undo',
  'scratch',
  'forget',
  'clear',
  'wipe',
  'empty',
  'purge',
];

const SINGULAR_NOUNS: ReadonlySet<string> = new Set(['note', 'memo', 'noet']);
const PLURAL_NOUNS: ReadonlySet<string> = new Set(['notes', 'memos', 'noets']);
const DEMONSTRATIVES: ReadonlySet<string> = new Set(['this', 'that', 'it']);
/** "notes app": the user means a program, not their saved notes. */
const APP_WORDS: ReadonlySet<string> = new Set([
  'app',
  'apps',
  'application',
  'applications',
  'program',
  'software',
]);
const DETERMINERS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'another',
  'new',
  'quick',
  'short',
  'my',
  'the',
]);
const QUERY_MARKERS: ReadonlySet<string> = new Set([
  'for',
  'about',
  'on',
  'regarding',
  'containing',
  'with',
  'mentioning',
  'matching',
  'saying',
  'having',
  'including',
  'that',
]);
const QUERY_NOISE: ReadonlySet<string> = new Set([
  'mention',
  'mentions',
  'say',
  'says',
  'contain',
  'contains',
  'include',
  'includes',
  'with',
  'about',
  'for',
  'the',
  'a',
  'an',
]);
const QUESTION_STARTS: ReadonlySet<string> = new Set([
  'what',
  'whats',
  "what's",
  'which',
  'do',
  'have',
  'any',
  'are',
  'is',
  'how',
]);
const QUESTION_CUES: ReadonlySet<string> = new Set(['my', 'i', 'have', 'any', 'got', 'there']);
const BARE_WORDS: ReadonlySet<string> = new Set(['my', 'the', 'all', 'your', 'our', 'me']);
const DELETE_FILLER: ReadonlySet<string> = new Set([
  'my',
  'the',
  'that',
  'this',
  'your',
  'our',
  'a',
  'an',
  'of',
  'last',
  'latest',
  'recent',
  'most',
  'previous',
  'newest',
  'final',
  'saved',
  'one',
  'it',
]);
const ALL_WORDS: ReadonlySet<string> = new Set(['all', 'every', 'everything']);
const CONFIRM_ANSWERS: ReadonlySet<string> = new Set([
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'confirm',
  'do it',
  'go ahead',
  'delete them',
  'delete all',
  'yes delete',
  'yes delete them',
  'yes delete all',
  'yes delete all notes',
]);

const CONFIRM_CLEAR =
  /^confirm (?:delete|clear|remove|erase|wipe)(?: all)?(?: of)?(?: my| the)? notes$/;
const ADD_TO_NOTES = /^(?:add|put|save) (.+?) (?:to|in|into) (?:my |the |your )?(?:notes?|memos?)$/;
const FIND_IN_NOTES =
  /^(?:find|search(?: for)?|look (?:for|up)|show(?: me)?|get) (?:for )?(.+?) in (?:my |the |all |your )*(?:notes?|memos?)$/;

function bare(token: string | undefined): string {
  return (token ?? '').replace(/[:;,]+$/, '');
}

function isNoteWord(token: string | undefined): boolean {
  const word = bare(token);
  return SINGULAR_NOUNS.has(word) || PLURAL_NOUNS.has(word);
}

/** The words of a note after the introduction: connecting words ("to self", "that", "of") go. */
function noteBody(input: NormalizedInput, from: number): string {
  const body = input.tokens.slice(from).filter((token) => bare(token) !== '');
  if (body[0] === 'to' && bare(body[1]) === 'self') body.splice(0, 2);
  while (body[0] === 'that' || body[0] === 'of' || body[0] === 'down' || body[0] === 'to') {
    body.shift();
  }
  return restoreCase(input.raw, body.join(' '));
}

function parseAdd(input: NormalizedInput): CommandMatch<NotesSlots> | null {
  const { text, tokens } = input;

  const addTo = ADD_TO_NOTES.exec(text);
  if (addTo !== null && !isNoteWord(addTo[1])) {
    return { slots: { action: 'add', text: restoreCase(input.raw, addTo[1] ?? '') }, score: 0.9 };
  }

  const verb = matchLeadingVerb(text, ADD_VERBS);
  if (verb !== null) {
    let index = 1;
    while (DETERMINERS.has(tokens[index] ?? '')) index += 1;
    if (isNoteWord(tokens[index])) {
      const body = noteBody(input, index + 1);
      const score = body === '' ? 0.7 : verb.exact ? 0.95 : 0.9;
      return { slots: { action: 'add', text: body }, score };
    }
  }

  const down = matchLeadingVerb(text, DOWN_VERBS);
  if (down !== null) {
    const pointer = DEMONSTRATIVES.has(tokens[1] ?? '') ? 2 : 1;
    if (bare(tokens[pointer]) === 'down') {
      const body = noteBody(input, pointer + 1);
      return { slots: { action: 'add', text: body }, score: body === '' ? 0.6 : 0.93 };
    }
  }

  if (bare(tokens[0]) === 'note') {
    const body = noteBody(input, 1);
    return { slots: { action: 'add', text: body }, score: body === '' ? 0.55 : 0.8 };
  }
  return null;
}

function parseDelete(text: string): CommandMatch<NotesSlots> | null {
  const verb = matchLeadingVerb(text, DELETE_VERBS);
  if (verb === null) return null;
  const rest = verb.rest.split(' ').filter(Boolean);
  const nounAt = rest.findIndex((token) => isNoteWord(token));
  if (nounAt < 0) return null;
  const others = rest.filter((_, index) => index !== nounAt);
  const wantsAll =
    others.some((token) => ALL_WORDS.has(token)) || PLURAL_NOUNS.has(rest[nounAt] ?? '');
  if (others.some((token) => !DELETE_FILLER.has(token) && !ALL_WORDS.has(token))) return null;
  return wantsAll
    ? { slots: { action: 'clear', confirmed: false }, score: 0.95 }
    : { slots: { action: 'delete-last' }, score: 0.97 };
}

function parseList(text: string, tokens: readonly string[]): CommandMatch<NotesSlots> | null {
  const nounAt = tokens.findIndex((token) => isNoteWord(token));
  if (nounAt < 0) return null;

  const inNotes = FIND_IN_NOTES.exec(text);
  if (inNotes !== null && !isNoteWord(inNotes[1])) {
    return { slots: { action: 'list', query: inNotes[1] ?? '' }, score: 0.95 };
  }

  const verb = matchLeadingVerb(text, LIST_VERBS);
  const first = tokens[0] ?? '';
  const question = QUESTION_STARTS.has(first) && tokens.some((token) => QUESTION_CUES.has(token));
  const topic = PLURAL_NOUNS.has(bare(first)) && QUERY_MARKERS.has(tokens[1] ?? '');
  const onlyNotes =
    PLURAL_NOUNS.has(bare(tokens[nounAt])) &&
    tokens.every((token, index) => index === nounAt || BARE_WORDS.has(token));
  if (verb === null && !question && !topic && !onlyNotes) return null;

  const after = tokens.slice(nounAt + 1);
  if (after.length > 0 && after.every((token) => APP_WORDS.has(token))) return null;
  const markerAt = after.findIndex((token) => QUERY_MARKERS.has(token));
  let words = markerAt >= 0 ? after.slice(markerAt + 1) : [];
  if (markerAt < 0 && verb !== null && /^(?:find|search|look)/.test(verb.verb)) words = after;
  while (words.length > 0 && QUERY_NOISE.has(words[0] ?? '')) words = words.slice(1);
  const query = stripArticles(words.join(' '));

  const score = verb !== null ? 0.95 : question ? 0.9 : topic ? 0.9 : 0.8;
  return { slots: query === '' ? { action: 'list' } : { action: 'list', query }, score };
}

function matchNotes(input: NormalizedInput, ctx: ParseContext): CommandMatch<NotesSlots> | null {
  const { text, tokens } = input;
  if (text === '') return null;

  if (CONFIRM_CLEAR.test(text)) return { slots: { action: 'clear', confirmed: true }, score: 1 };
  return parseDelete(text) ?? parseAdd(input) ?? parseList(text, tokens) ?? matchAnswer(input, ctx);
}

/** Answers to "What should the note say?" and to the "delete all notes?" question. */
function matchAnswer(input: NormalizedInput, ctx: ParseContext): CommandMatch<NotesSlots> | null {
  if (pendingQuestion(ctx, 'notes', 'note-text') !== null) {
    const body = noteBody(input, 0);
    return body === '' ? null : { slots: { action: 'add', text: body }, score: 0.5 };
  }
  if (pendingQuestion(ctx, 'notes', 'notes-clear') !== null && CONFIRM_ANSWERS.has(input.text)) {
    return { slots: { action: 'clear', confirmed: true }, score: 0.6 };
  }
  return null;
}

function addNote(text: string, ctx: RunContext): CommandResult {
  if (text === '') {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: 'note',
          title: 'What should the note say?',
          detail: 'For example: "take a note buy milk".',
        }),
      ],
      speech: 'What should the note say?',
      pin: true,
      context: { awaiting: 'note-text' },
    };
  }
  if (text.length > MAX_NOTE_LENGTH) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'warning',
          icon: 'note',
          title: 'That note is too long',
          detail: `Notes can have up to ${MAX_NOTE_LENGTH} characters.`,
        }),
      ],
      speech: 'That note is too long.',
      autoCloseMs: 4000,
    };
  }
  const note = ctx.services.notes.add(text);
  return {
    cards: [
      statusCard(ctx, {
        tone: 'success',
        icon: 'note',
        title: 'Note saved',
        detail: note.text,
        copyText: note.text,
      }),
    ],
    speech: 'Note saved',
    autoCloseMs: 2500,
  };
}

function notesCard(
  ctx: RunContext,
  notes: NoteItem[],
  total: number,
  query: string | undefined,
): NotesCard {
  const card: NotesCard = {
    kind: 'notes',
    id: ctx.newId(),
    createdAt: ctx.now.getTime(),
    title: query === undefined ? 'Your notes' : `Notes about "${query}"`,
    notes,
    total,
    copyText: notes.map((note) => `- ${note.text}`).join('\n'),
  };
  if (query !== undefined) card.query = query;
  return card;
}

function listNotes(query: string | undefined, ctx: RunContext): CommandResult {
  const { notes, total } = ctx.services.notes.list(query, LIST_LIMIT);
  const latest = notes[0];
  if (latest === undefined) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: 'note',
          title: query === undefined ? 'No notes yet' : `No notes about "${query}"`,
          detail: 'Say "take a note buy milk" to save one.',
        }),
      ],
      speech:
        query === undefined ? "You don't have any notes yet." : `I found no notes about ${query}.`,
      autoCloseMs: 3500,
    };
  }
  const speech =
    query !== undefined
      ? `I found ${count(total, 'note')} about ${query}.`
      : total === 1
        ? `You have one note: ${snippet(latest.text, 120)}`
        : `You have ${total} notes. The latest says: ${snippet(latest.text, 120)}`;
  return { cards: [notesCard(ctx, notes, total, query)], speech, pin: true };
}

function deleteLast(ctx: RunContext): CommandResult {
  const removed = ctx.services.notes.deleteLast();
  if (removed === null) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: 'trash',
          title: 'No notes to delete',
          detail: "You don't have any notes yet.",
        }),
      ],
      speech: "You don't have any notes to delete.",
      autoCloseMs: 3000,
    };
  }
  return {
    cards: [
      statusCard(ctx, {
        tone: 'success',
        icon: 'trash',
        title: 'Deleted your last note',
        detail: removed.text,
        ...(removed.text.length <= 300
          ? { actions: [{ type: 'command', label: 'Undo', text: `take a note ${removed.text}` }] }
          : {}),
      }),
    ],
    speech: 'Deleted your last note',
    autoCloseMs: 5000,
  };
}

function clearNotes(confirmed: boolean, ctx: RunContext): CommandResult {
  const { total } = ctx.services.notes.list(undefined, 0);
  if (total === 0) {
    return {
      cards: [
        statusCard(ctx, {
          tone: 'neutral',
          icon: 'trash',
          title: 'No notes to delete',
          detail: "You don't have any notes yet.",
        }),
      ],
      speech: "You don't have any notes to delete.",
      autoCloseMs: 3000,
    };
  }
  if (!confirmed) {
    const question = total === 1 ? 'Delete your note?' : `Delete all ${total} notes?`;
    return {
      cards: [
        statusCard(ctx, {
          tone: 'warning',
          icon: 'trash',
          title: question,
          detail: "This can't be undone.",
          actions: [{ type: 'command', label: 'Yes, delete all notes', text: CLEAR_CONFIRMATION }],
        }),
      ],
      speech: `${question} Say yes to confirm.`,
      pin: true,
      context: { awaiting: 'notes-clear' },
    };
  }
  const removed = ctx.services.notes.clear();
  return {
    cards: [
      statusCard(ctx, {
        tone: 'success',
        icon: 'trash',
        title: removed === 1 ? 'Deleted your note' : `Deleted all ${removed} notes`,
      }),
    ],
    speech: removed === 1 ? 'Deleted your note' : `Deleted all ${removed} notes`,
    autoCloseMs: 3000,
  };
}

export const notesCommand = defineCommand<NotesSlots>({
  id: 'notes',
  number: 16,
  group: 'productivity',
  title: 'Notes',
  icon: 'note',
  examples: [
    'take a note buy milk',
    'show my notes',
    'search notes for milk',
    'delete last note',
    'clear all my notes',
  ],
  match: matchNotes,
  run(slots, ctx) {
    switch (slots.action) {
      case 'add':
        return addNote(slots.text, ctx);
      case 'list':
        return listNotes(slots.query, ctx);
      case 'delete-last':
        return deleteLast(ctx);
      case 'clear':
        return clearNotes(slots.confirmed, ctx);
    }
  },
});

/**
 * Contracts for the command engine. Everything under src/main/commands, src/main/system
 * and src/main/services (except explicit electron adapters) must stay free of `electron`
 * imports so it can be unit-tested in plain Node: dependencies are injected.
 */
import type {
  CardIcon,
  CommandResult,
  ConfirmCard,
  ConversationTurn,
  DefinitionCard,
  HistoryEntry,
  NoteItem,
  TimerCard,
  WeatherCard,
} from '@shared/cards';
import type { SystemApi } from '../system/types';

export type { Logger } from '@shared/logger';
import type { Logger } from '@shared/logger';

export type CommandGroup = 'apps-web' | 'info' | 'productivity' | 'system' | 'assistant';

/** User text after normalisation (see text.ts). */
export interface NormalizedInput {
  /** Original text exactly as received. */
  raw: string;
  /**
   * Lower-cased, wake phrase / politeness fillers removed, whitespace collapsed,
   * trailing punctuation removed. Keeps %, :, ., ', + - * / ^ ( ) inside the text.
   */
  text: string;
  /** `text` split on whitespace. */
  tokens: string[];
}

export interface ParseContext {
  now: Date;
  /** Most recent turn last, at most 5. */
  turns: readonly ConversationTurn[];
}

export interface CommandMatch<S> {
  slots: S;
  /** 0..1 - how sure the matcher is. Highest score wins, `priority` breaks ties. */
  score: number;
}

/** Read-only settings snapshot visible to commands. */
export interface CommandSettings {
  units: 'metric' | 'imperial';
  weatherLocation: { mode: 'auto' | 'manual'; city: string };
  /** True when Azure OpenAI is configured and usable. */
  aiConfigured: boolean;
}

export interface RunContext {
  now: Date;
  turns: readonly ConversationTurn[];
  settings: CommandSettings;
  services: CommandServices;
  logger: Logger;
  /** Aborted when the user says stop / presses Esc. */
  signal: AbortSignal;
  /** Creates a unique card id. */
  newId(): string;
}

export interface CommandModule<S = unknown> {
  /** Stable kebab-case id, e.g. "open-app". */
  readonly id: string;
  /** Number in the product spec (1-29). */
  readonly number: number;
  readonly group: CommandGroup;
  /** Short title shown in the command gallery. */
  readonly title: string;
  readonly icon: CardIcon;
  /** Phrases shown in the gallery; each must be matched by this command. */
  readonly examples: readonly string[];
  /** Tie-breaker when two commands score the same (higher wins). Default 0. */
  readonly priority?: number;
  /** Pure function: decide whether the input is for this command and extract slots. */
  match(input: NormalizedInput, ctx: ParseContext): CommandMatch<S> | null;
  run(slots: S, ctx: RunContext): Promise<CommandResult> | CommandResult;
}

/**
 * Type-erased module as stored in registries. Method-style declarations make
 * `CommandModule<{ query: string }>` assignable to this.
 */
export type AnyCommandModule = CommandModule<unknown>;

/** Identity helper that infers the slot type from `match`. */
export function defineCommand<S>(module: CommandModule<S>): CommandModule<S> {
  return module;
}

export interface ParsedIntent {
  command: AnyCommandModule;
  slots: unknown;
  score: number;
  input: NormalizedInput;
}

// ---------------------------------------------------------------------------
// Services injected into commands
// ---------------------------------------------------------------------------

export interface WeatherQuery {
  /** City / place name. Undefined = the user's default location. */
  place?: string;
  units: 'metric' | 'imperial';
}

export type WeatherErrorCode = 'no-network' | 'not-found' | 'bad-response' | 'no-location';

export class WeatherError extends Error {
  constructor(
    readonly code: WeatherErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WeatherError';
  }
}

export interface WeatherService {
  /** Resolves a forecast (7 days) for the place; `focusDay` is set by the caller. */
  forecast(
    query: WeatherQuery,
  ): Promise<Omit<WeatherCard, 'id' | 'createdAt' | 'focusDay' | 'verdict'>>;
}

export interface DictionaryService {
  /** Returns null when the word is unknown. Throws on network failures. */
  define(word: string): Promise<Omit<DefinitionCard, 'id' | 'createdAt'> | null>;
}

export interface NotesService {
  add(text: string): NoteItem;
  /** Newest first. `query` filters case-insensitively. */
  list(query?: string, limit?: number): { notes: NoteItem[]; total: number };
  /** Removes the most recent note and returns it (null when there are none). */
  deleteLast(): NoteItem | null;
  clear(): number;
}

export interface TimerRecord {
  id: string;
  type: TimerCard['timerType'];
  label: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  state: TimerCard['state'];
}

export interface TimersService {
  startTimer(options: { durationMs: number; label?: string }): TimerRecord;
  /** Reminder or alarm firing at the absolute time `at` (epoch ms). */
  schedule(options: { at: number; label: string; type: 'reminder' | 'alarm' }): TimerRecord;
  /** Running timers/reminders/alarms, soonest first. */
  list(): TimerRecord[];
  cancel(id: string): boolean;
  cancelAll(): number;
  /**
   * Subscribes to fire events (timer reached zero). `missed` is true when the record became due
   * while the app was not running and is delivered late after a restart/resume.
   * Returns an unsubscribe function.
   */
  onFire(listener: (record: TimerRecord, info: { missed: boolean }) => void): () => void;
}

export interface HistoryService {
  add(entry: Omit<HistoryEntry, 'id'>): HistoryEntry;
  /** Newest first. */
  list(query?: string, limit?: number): HistoryEntry[];
  clear(): number;
}

export interface ConfirmRequest {
  action: ConfirmCard['action'];
  title: string;
  detail?: string;
  confirmLabel: string;
  danger: boolean;
  /** When set the confirmed action runs after this many seconds unless cancelled. */
  countdownSeconds?: number;
  /** Executed once the user confirmed (and the countdown elapsed, if any). */
  run: () => Promise<void>;
}

export interface ConfirmationService {
  /** Registers a pending action and returns the card asking the user to confirm. */
  request(request: ConfirmRequest): ConfirmCard;
}

export interface UiBridge {
  openSettings(
    section?:
      | 'general'
      | 'voice'
      | 'hotkeys'
      | 'circle'
      | 'capture'
      | 'dictation'
      | 'ai'
      | 'privacy'
      | 'updates'
      | 'about',
  ): void;
  openCircleToSearch(): void;
  /** Captures the display under the cursor and opens it in Capture Studio. */
  startCapture(source?: 'hotkey' | 'voice' | 'tray' | 'ui'): void;
  /** Opens Capture Studio for a screenshot that was already saved to disk. */
  openCaptureStudio(shot: { path: string; width: number; height: number }): void;
  /** Starts dictation anywhere (what the dictation hotkey does). */
  startDictation(): void;
  /** Stops TTS playback. */
  stopSpeaking(): void;
  /** Cancels pending confirmations/countdowns and any streaming answer. Returns what was cancelled. */
  cancelPending(): { confirmations: number; streams: number };
  copyToClipboard(text: string): void;
  /** Plain text of the most recent answer card, or null. */
  getLastAnswerText(): string | null;
  /** Opens an http(s) URL in the default browser. Returns false if the URL was rejected. */
  openExternal(url: string): Promise<boolean>;
}

export interface CommandServices {
  system: SystemApi;
  weather: WeatherService;
  dictionary: DictionaryService;
  notes: NotesService;
  timers: TimersService;
  history: HistoryService;
  confirm: ConfirmationService;
  ui: UiBridge;
  /** Registered commands, used by the gallery ("what can you do"). */
  listCommands(): readonly AnyCommandModule[];
}

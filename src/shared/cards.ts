/**
 * Shared card model: everything the assistant bar can render.
 * Commands (main process) produce cards, the assistant renderer displays them.
 * Types only - no runtime code - so it is safe to import from any process.
 */

export type CardTone = 'neutral' | 'success' | 'warning' | 'error';

export type CardIcon =
  | 'app'
  | 'web'
  | 'search'
  | 'youtube'
  | 'clock'
  | 'calendar'
  | 'weather'
  | 'battery'
  | 'cpu'
  | 'calculator'
  | 'convert'
  | 'book'
  | 'timer'
  | 'bell'
  | 'alarm'
  | 'note'
  | 'copy'
  | 'volume'
  | 'mute'
  | 'brightness'
  | 'screenshot'
  | 'lock'
  | 'settings'
  | 'trash'
  | 'power'
  | 'restart'
  | 'sleep'
  | 'moon'
  | 'circle'
  | 'sparkle'
  | 'help'
  | 'stop'
  | 'check'
  | 'warning'
  | 'error'
  | 'info'
  | 'mic'
  | 'wifi'
  | 'bluetooth'
  | 'display'
  | 'sound';

/** Buttons rendered at the bottom of a card. */
export type CardAction =
  /** Opens an http(s) URL in the default browser. */
  | { type: 'url'; label: string; url: string }
  /** Submits `text` to the assistant as if the user had typed it. */
  | { type: 'command'; label: string; text: string }
  /** Opens a file or reveals it in Explorer. Main only honours paths inside Beekeeper-owned folders. */
  | { type: 'path'; label: string; path: string; mode: 'open' | 'reveal' };

export interface CardBase {
  /** Unique per card instance. */
  id: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Plain text used by the Copy button and by the "copy that" command. */
  copyText?: string;
  /** http(s) URL used by the "Open in browser" button. */
  openUrl?: string;
  actions?: CardAction[];
}

export interface TextCard extends CardBase {
  kind: 'text';
  title?: string;
  /** Rendered as Markdown (no raw HTML). */
  markdown: string;
}

/** Streaming answer from Azure OpenAI. `markdown` grows through assistant:stream events. */
export interface AnswerCard extends CardBase {
  kind: 'answer';
  markdown: string;
  streaming: boolean;
  model?: string;
  error?: string;
}

export interface StatusCard extends CardBase {
  kind: 'status';
  tone: CardTone;
  icon: CardIcon;
  title: string;
  detail?: string;
}

export interface TimeCard extends CardBase {
  kind: 'time';
  /** ISO-8601 timestamp the card was computed for. */
  iso: string;
  /** e.g. "3:42 PM" */
  timeText: string;
  /** e.g. "Tuesday, November 10, 2026" */
  dateText: string;
  /** e.g. "Tuesday" */
  weekday: string;
  /** IANA zone, e.g. "Asia/Kolkata" */
  zone: string;
  /** What the user asked for; the UI emphasises it. */
  focus: 'time' | 'date' | 'day';
}

export type WeatherCondition =
  'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm';

export interface WeatherDay {
  /** YYYY-MM-DD in the place's local time. */
  date: string;
  /** "Today", "Tomorrow" or a short weekday such as "Wed". */
  label: string;
  condition: WeatherCondition;
  /** Human text, e.g. "Light rain". */
  summary: string;
  tempMax: number;
  tempMin: number;
  /** 0-100 */
  precipChance: number;
}

export interface WeatherCard extends CardBase {
  kind: 'weather';
  /** e.g. "Paris, France" */
  place: string;
  units: 'metric' | 'imperial';
  current: {
    temp: number;
    feelsLike: number;
    condition: WeatherCondition;
    summary: string;
    isDay: boolean;
    humidity: number;
    windSpeed: number;
    windUnit: 'km/h' | 'mph';
  };
  /** Up to 7 days, index 0 is today. */
  days: WeatherDay[];
  /** Index into `days` of the day the user asked about (0 = today, 1 = tomorrow). */
  focusDay: number;
  /** One-line answer to a yes/no question such as "will it rain tomorrow". */
  verdict?: string;
}

export interface BatteryCard extends CardBase {
  kind: 'battery';
  hasBattery: boolean;
  /** 0-100, undefined when there is no battery. */
  percent?: number;
  charging: boolean;
  onAc: boolean;
  minutesRemaining?: number;
}

export interface SystemInfoCard extends CardBase {
  kind: 'sysinfo';
  os: string;
  cpu: { name: string; cores: number; usagePercent: number };
  memory: { totalBytes: number; usedBytes: number; usagePercent: number };
  disk: { drive: string; totalBytes: number; freeBytes: number; usagePercent: number };
  uptimeSeconds: number;
}

export interface CalculationCard extends CardBase {
  kind: 'calc';
  expression: string;
  resultText: string;
  value: number;
}

export interface ConversionCard extends CardBase {
  kind: 'conversion';
  category: 'length' | 'weight' | 'temperature' | 'data';
  fromText: string;
  toText: string;
}

export interface DefinitionCard extends CardBase {
  kind: 'definition';
  word: string;
  phonetic?: string;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
    synonyms?: string[];
  }>;
  sourceUrl?: string;
}

export interface TimerCard extends CardBase {
  kind: 'timer';
  timerId: string;
  /** timer = countdown, alarm = clock time, reminder = clock time with text */
  timerType: 'timer' | 'alarm' | 'reminder';
  label: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  state: 'running' | 'done' | 'cancelled';
}

export interface NoteItem {
  id: string;
  text: string;
  createdAt: number;
}

export interface NotesCard extends CardBase {
  kind: 'notes';
  title: string;
  notes: NoteItem[];
  total: number;
  query?: string;
}

export interface GalleryCard extends CardBase {
  kind: 'gallery';
  groups: Array<{
    title: string;
    commands: Array<{ title: string; icon: CardIcon; examples: string[] }>;
  }>;
}

export type ConfirmAction = 'shutdown' | 'restart' | 'sleep' | 'empty-recycle-bin' | 'force-close';

/** Asks the user to confirm a risky action. Power actions continue into a countdown card. */
export interface ConfirmCard extends CardBase {
  kind: 'confirm';
  confirmId: string;
  action: ConfirmAction;
  title: string;
  detail?: string;
  confirmLabel: string;
  danger: boolean;
  /** When set, confirming starts a cancellable countdown of this many seconds. */
  countdownSeconds?: number;
}

/** Replaces a ConfirmCard once the user confirmed a power action. */
export interface CountdownCard extends CardBase {
  kind: 'countdown';
  confirmId: string;
  action: ConfirmAction;
  title: string;
  detail?: string;
  startedAt: number;
  endsAt: number;
}

export interface SearchCard extends CardBase {
  kind: 'search';
  engine: 'google' | 'bing' | 'youtube' | 'web';
  query: string;
  url: string;
}

export interface ScreenshotCard extends CardBase {
  kind: 'screenshot';
  /** Absolute path of the saved PNG. */
  path: string;
  width: number;
  height: number;
}

export type Card =
  | TextCard
  | AnswerCard
  | StatusCard
  | TimeCard
  | WeatherCard
  | BatteryCard
  | SystemInfoCard
  | CalculationCard
  | ConversionCard
  | DefinitionCard
  | TimerCard
  | NotesCard
  | GalleryCard
  | ConfirmCard
  | CountdownCard
  | SearchCard
  | ScreenshotCard;

export type CardKind = Card['kind'];

/** What a command returns to the assistant. */
export interface CommandResult {
  cards: Card[];
  /** Short text read aloud when TTS is enabled. Omit to stay silent. */
  speech?: string;
  /** Hide the bar after this many ms (e.g. after "open notepad"). Ignored when `pin` is true. */
  autoCloseMs?: number;
  /** Keep the bar open even when it loses focus (timers, confirmations, answers). */
  pin?: boolean;
  /** Close the bar immediately. */
  closeNow?: boolean;
  /** Free-form data remembered with this turn for follow-ups ("what about tomorrow?"). */
  context?: Record<string, unknown>;
}

/** One exchange kept in short-term memory (last 5) for follow-up questions. */
export interface ConversationTurn {
  id: string;
  at: number;
  text: string;
  /** Command id that handled the turn, or null for the AI/web fallback. */
  commandId: string | null;
  /** Slots extracted by the parser. */
  slots?: unknown;
  /** Context returned by the command (see CommandResult.context). */
  context?: Record<string, unknown>;
}

/** Persisted history row (last 200 interactions). */
export interface HistoryEntry {
  id: string;
  at: number;
  text: string;
  source: 'text' | 'voice' | 'circle';
  commandId: string | null;
  /** Short one-line summary of the answer for the history list. */
  summary: string;
}

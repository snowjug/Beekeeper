import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ConversationTurn, HistoryEntry } from '@shared/cards';
import type { Logger } from '@shared/logger';
import type { SystemApi } from '@main/system/types';
import { normalizeInput } from '@main/commands/text';
import type {
  AnyCommandModule,
  CommandMatch,
  CommandModule,
  CommandServices,
  CommandSettings,
  ConfirmRequest,
  ParseContext,
  RunContext,
  UiBridge,
  WeatherService,
} from '@main/commands/types';

/** Tuesday, November 10 2026, 3:42 PM in the machine's own time zone. */
export const NOW = new Date(2026, 10, 10, 15, 42, 0);

export function parseContext(
  turns: readonly ConversationTurn[] = [],
  now: Date = NOW,
): ParseContext {
  return { now, turns };
}

export interface FakeLogger extends Logger {
  debug: Mock<Logger['debug']>;
  info: Mock<Logger['info']>;
  warn: Mock<Logger['warn']>;
  error: Mock<Logger['error']>;
}

export function createFakeLogger(): FakeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

type ForecastData = Awaited<ReturnType<WeatherService['forecast']>>;

/** A 7-day forecast for Paris (metric): partly cloudy today, rain tomorrow. */
export function sampleForecast(overrides: Partial<ForecastData> = {}): ForecastData {
  const day = (
    date: string,
    label: string,
    condition: ForecastData['days'][number]['condition'],
    summary: string,
    tempMax: number,
    tempMin: number,
    precipChance: number,
  ): ForecastData['days'][number] => ({
    date,
    label,
    condition,
    summary,
    tempMax,
    tempMin,
    precipChance,
  });
  return {
    kind: 'weather',
    place: 'Paris, France',
    units: 'metric',
    current: {
      temp: 18,
      feelsLike: 17,
      condition: 'partly-cloudy',
      summary: 'Partly cloudy',
      isDay: true,
      humidity: 60,
      windSpeed: 11,
      windUnit: 'km/h',
    },
    days: [
      day('2026-11-10', 'Today', 'partly-cloudy', 'Partly cloudy', 21, 12, 10),
      day('2026-11-11', 'Tomorrow', 'rain', 'Rain', 17, 11, 80),
      day('2026-11-12', 'Thu', 'cloudy', 'Overcast', 15, 9, 20),
      day('2026-11-13', 'Fri', 'clear', 'Clear sky', 16, 8, 0),
      day('2026-11-14', 'Sat', 'drizzle', 'Light drizzle', 14, 9, 45),
      day('2026-11-15', 'Sun', 'snow', 'Snow', 2, -3, 70),
      day('2026-11-16', 'Mon', 'thunderstorm', 'Thunderstorm', 19, 12, 90),
    ],
    ...overrides,
  };
}

export const SAMPLE_SYSTEM_INFO = {
  os: 'Windows 11 Pro',
  cpu: { name: 'Intel Core i7-1165G7', cores: 8, usagePercent: 12 },
  memory: { totalBytes: 17_179_869_184, usedBytes: 8_589_934_592, usagePercent: 50 },
  disk: { drive: 'C:', totalBytes: 511_000_000_000, freeBytes: 128_000_000_000, usagePercent: 75 },
  uptimeSeconds: 3 * 86_400 + 4 * 3600 + 30 * 60,
};

export function createFakeSystem(overrides: Partial<SystemApi> = {}): SystemApi {
  return {
    findApps: vi.fn(() => Promise.resolve([])),
    launchApp: vi.fn(() => Promise.resolve()),
    closeApp: vi.fn(() => Promise.resolve({ status: 'closed' as const, processes: [] })),
    openSettingsPage: vi.fn(() => Promise.resolve()),
    lockWorkstation: vi.fn(() => Promise.resolve()),
    emptyRecycleBin: vi.fn(() => Promise.resolve()),
    power: vi.fn(() => Promise.resolve()),
    setDarkMode: vi.fn(() => Promise.resolve('dark' as const)),
    takeScreenshot: vi.fn(() =>
      Promise.resolve({ path: 'C:\\Shots\\a.png', width: 1920, height: 1080 }),
    ),
    getVolume: vi.fn(() => Promise.resolve({ percent: 40, muted: false })),
    setVolume: vi.fn(() => Promise.resolve({ percent: 40, muted: false })),
    adjustVolume: vi.fn(() => Promise.resolve({ percent: 50, muted: false })),
    setMuted: vi.fn(() => Promise.resolve({ percent: 40, muted: true })),
    getBrightness: vi.fn(() => Promise.resolve(60)),
    setBrightness: vi.fn(() => Promise.resolve(60)),
    getBattery: vi.fn(() =>
      Promise.resolve({
        hasBattery: true,
        percent: 62,
        charging: false,
        onAc: false,
        minutesRemaining: 190,
      }),
    ),
    getSystemInfo: vi.fn(() => Promise.resolve(SAMPLE_SYSTEM_INFO)),
    ...overrides,
  };
}

export interface FakeUi {
  openSettings: Mock<UiBridge['openSettings']>;
  openCircleToSearch: Mock<UiBridge['openCircleToSearch']>;
  startCapture: Mock<UiBridge['startCapture']>;
  openCaptureStudio: Mock<UiBridge['openCaptureStudio']>;
  startDictation: Mock<UiBridge['startDictation']>;
  stopSpeaking: Mock<UiBridge['stopSpeaking']>;
  cancelPending: Mock<UiBridge['cancelPending']>;
  copyToClipboard: Mock<UiBridge['copyToClipboard']>;
  getLastAnswerText: Mock<UiBridge['getLastAnswerText']>;
  openExternal: Mock<UiBridge['openExternal']>;
}

/** CommandServices whose UI bridge exposes its spies. */
export interface FakeServices extends Omit<CommandServices, 'ui'> {
  ui: FakeUi;
}

/** Every service is a spy with a harmless default; pass `overrides` to change one. */
export function createFakeServices(
  commands: readonly AnyCommandModule[] = [],
  overrides: Partial<FakeServices> = {},
): FakeServices {
  const note = { id: 'note-1', text: 'note', createdAt: NOW.getTime() };
  const record = {
    id: 'timer-1',
    type: 'timer' as const,
    label: 'Timer',
    durationMs: 60_000,
    startedAt: NOW.getTime(),
    endsAt: NOW.getTime() + 60_000,
    state: 'running' as const,
  };
  return {
    system: createFakeSystem(),
    weather: { forecast: vi.fn(() => Promise.resolve(sampleForecast())) },
    dictionary: { define: vi.fn(() => Promise.resolve(null)) },
    notes: {
      add: vi.fn(() => note),
      list: vi.fn(() => ({ notes: [], total: 0 })),
      deleteLast: vi.fn(() => null),
      clear: vi.fn(() => 0),
    },
    timers: {
      startTimer: vi.fn(() => record),
      schedule: vi.fn(() => record),
      list: vi.fn(() => []),
      cancel: vi.fn(() => false),
      cancelAll: vi.fn(() => 0),
      onFire: vi.fn(() => () => undefined),
    },
    history: {
      add: vi.fn((entry: Omit<HistoryEntry, 'id'>) => ({ id: 'history-1', ...entry })),
      list: vi.fn(() => []),
      clear: vi.fn(() => 0),
    },
    confirm: {
      request: vi.fn((request: ConfirmRequest) => ({
        kind: 'confirm' as const,
        id: 'confirm-card',
        createdAt: NOW.getTime(),
        confirmId: 'confirm-1',
        action: request.action,
        title: request.title,
        confirmLabel: request.confirmLabel,
        danger: request.danger,
      })),
    },
    ui: {
      openSettings: vi.fn(),
      openCircleToSearch: vi.fn(),
      startCapture: vi.fn(),
      openCaptureStudio: vi.fn(),
      startDictation: vi.fn(),
      stopSpeaking: vi.fn(),
      cancelPending: vi.fn(() => ({ confirmations: 0, streams: 0 })),
      copyToClipboard: vi.fn(),
      getLastAnswerText: vi.fn(() => null),
      openExternal: vi.fn(() => Promise.resolve(true)),
    },
    listCommands: () => commands,
    ...overrides,
  };
}

export interface RunContextOptions {
  now?: Date;
  turns?: readonly ConversationTurn[];
  settings?: Partial<CommandSettings>;
  services?: CommandServices;
  logger?: Logger;
  signal?: AbortSignal;
}

export function runContext(options: RunContextOptions = {}): RunContext {
  let counter = 0;
  return {
    now: options.now ?? NOW,
    turns: options.turns ?? [],
    settings: {
      units: 'metric',
      weatherLocation: { mode: 'auto', city: '' },
      aiConfigured: false,
      ...options.settings,
    },
    services: options.services ?? createFakeServices(),
    logger: options.logger ?? createFakeLogger(),
    signal: options.signal ?? new AbortController().signal,
    newId: () => {
      counter += 1;
      return `id-${counter}`;
    },
  };
}

export function turn(
  commandId: string | null,
  text: string,
  extra: Partial<ConversationTurn> = {},
): ConversationTurn {
  return { id: `turn-${text}`, at: NOW.getTime(), text, commandId, ...extra };
}

/** Runs one command's matcher the way the engine would (normalised input). */
export function matchOf<S>(
  command: CommandModule<S>,
  text: string,
  ctx: ParseContext = parseContext(),
): CommandMatch<S> | null {
  return command.match(normalizeInput(text), ctx);
}

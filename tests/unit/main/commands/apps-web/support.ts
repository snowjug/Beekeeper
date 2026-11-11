import { vi, type Mock } from 'vitest';
import type { CommandResult, ConfirmCard } from '@shared/cards';
import { silentLogger } from '@shared/logger';
import { normalizeInput } from '@main/commands/text';
import type {
  CommandMatch,
  CommandModule,
  CommandServices,
  ConfirmRequest,
  RunContext,
  UiBridge,
} from '@main/commands/types';
import type { SystemApi } from '@main/system/types';

export const NOW = new Date('2026-11-10T10:30:00.000Z');

export function match<S>(command: CommandModule<S>, text: string): CommandMatch<S> | null {
  return command.match(normalizeInput(text), { now: NOW, turns: [] });
}

export function slotsOf<S>(command: CommandModule<S>, text: string): S | null {
  return match(command, text)?.slots ?? null;
}

export function scoreOf<S>(command: CommandModule<S>, text: string): number {
  return match(command, text)?.score ?? 0;
}

export type SystemMocks = { [K in keyof SystemApi]: Mock<SystemApi[K]> };

const SYSTEM_METHODS: ReadonlyArray<keyof SystemApi> = [
  'findApps',
  'launchApp',
  'closeApp',
  'openSettingsPage',
  'lockWorkstation',
  'emptyRecycleBin',
  'power',
  'setDarkMode',
  'takeScreenshot',
  'getVolume',
  'setVolume',
  'adjustVolume',
  'setMuted',
  'getBrightness',
  'setBrightness',
  'getBattery',
  'getSystemInfo',
];

/** A SystemApi whose methods fail loudly unless a test configured them. */
export function createFakeSystem(overrides: Partial<SystemApi> = {}): SystemMocks {
  const entries = SYSTEM_METHODS.map((name) => {
    const implementation =
      overrides[name] ?? (() => Promise.reject(new Error(`Unexpected call to system.${name}`)));
    return [name, vi.fn(implementation)] as const;
  });
  return Object.fromEntries(entries) as unknown as SystemMocks;
}

export interface Harness {
  ctx: RunContext;
  system: SystemMocks;
  ui: { [K in keyof UiBridge]: Mock<UiBridge[K]> };
  /** Requests registered through services.confirm.request, oldest first. */
  confirmations: ConfirmRequest[];
}

function unusedService<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      throw new Error(`Unexpected use of services.${name}.${String(property)}`);
    },
  });
}

export interface HarnessOptions {
  system?: Partial<SystemApi>;
  /** Result of ui.openExternal. Default true. */
  openExternal?: boolean | (() => Promise<boolean>);
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const system = createFakeSystem(options.system);
  const confirmations: ConfirmRequest[] = [];
  const openExternal = options.openExternal ?? true;
  const ui = {
    openSettings: vi.fn(),
    openCircleToSearch: vi.fn(),
    startCapture: vi.fn(),
    openCaptureStudio: vi.fn(),
    startDictation: vi.fn(),
    stopSpeaking: vi.fn(),
    cancelPending: vi.fn(() => ({ confirmations: 0, streams: 0 })),
    copyToClipboard: vi.fn(),
    getLastAnswerText: vi.fn(() => null),
    openExternal: vi.fn(
      typeof openExternal === 'function' ? openExternal : () => Promise.resolve(openExternal),
    ),
  } satisfies { [K in keyof UiBridge]: Mock<UiBridge[K]> };

  const services: CommandServices = {
    system,
    ui,
    confirm: {
      request(request): ConfirmCard {
        confirmations.push(request);
        return {
          kind: 'confirm',
          id: `confirm-${confirmations.length}`,
          createdAt: NOW.getTime(),
          confirmId: `c${confirmations.length}`,
          action: request.action,
          title: request.title,
          detail: request.detail,
          confirmLabel: request.confirmLabel,
          danger: request.danger,
          countdownSeconds: request.countdownSeconds,
        };
      },
    },
    weather: unusedService('weather'),
    dictionary: unusedService('dictionary'),
    notes: unusedService('notes'),
    timers: unusedService('timers'),
    history: unusedService('history'),
    listCommands: () => [],
  };

  let counter = 0;
  const ctx: RunContext = {
    now: NOW,
    turns: [],
    settings: { units: 'metric', weatherLocation: { mode: 'auto', city: '' }, aiConfigured: false },
    services,
    logger: silentLogger,
    signal: new AbortController().signal,
    newId: () => `card-${(counter += 1)}`,
  };
  return { ctx, system, ui, confirmations };
}

export async function runCommand<S>(
  command: CommandModule<S>,
  slots: S,
  harness: Harness,
): Promise<CommandResult> {
  return await command.run(slots, harness.ctx);
}

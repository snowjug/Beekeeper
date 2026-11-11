import { vi } from 'vitest';
import type { MicSession } from '@renderer/lib/voice/mic';
import type { Bridge } from '@shared/ipc/bridge';
import type { EventChannelFor, InvokeChannelFor } from '@shared/ipc/channels';
import type { EventPayload } from '@shared/ipc/schemas';
import type { AppInfo, HotkeyStatus, VoiceModelState } from '@shared/ipc/types';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  type SettingsPatch,
  type SettingsView,
} from '@shared/settings';

type Role = 'onboarding';
type InvokeName = InvokeChannelFor<Role>;
type Handler = (input: unknown) => unknown;

export interface FakeBridge {
  bridge: Bridge<Role>;
  /** Every invoke so far (oldest first). */
  calls: Array<{ channel: string; input: unknown }>;
  /** Replaces the answer of one channel; a thrown error rejects the invoke. */
  handle: (channel: InvokeName, handler: Handler) => void;
  /** Delivers a main-process event to the page. */
  emit: <C extends EventChannelFor<Role>>(channel: C, payload: EventPayload<C>) => void;
  /** Inputs of every invoke of one channel. */
  inputsOf: (channel: InvokeName) => unknown[];
  listenerCount: (channel: string) => number;
}

export const APP_INFO: AppInfo = {
  name: 'Beekeeper',
  version: '1.0.0',
  platform: 'win32',
  electron: '45.0.0',
  chrome: '140.0.0',
  isPackaged: false,
  isDev: true,
  portable: false,
  material: 'mica',
  theme: 'dark',
  role: 'onboarding',
  osBuild: 26100,
  userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Beekeeper',
};

export function modelState(overrides: Partial<VoiceModelState> = {}): VoiceModelState {
  return {
    state: 'missing',
    receivedBytes: 0,
    totalBytes: 41_184_862,
    bytesPerSecond: 0,
    etaSeconds: null,
    attempt: 1,
    maxAttempts: 4,
    modelUrl: null,
    displayName: 'English (US) speech model, small',
    ...overrides,
  };
}

export function settingsView(patch: SettingsPatch = {}): SettingsView {
  return {
    ...applySettingsPatch(DEFAULT_SETTINGS, patch),
    secrets: { speechKey: null, openAiKey: null, elevenLabsKey: null },
  };
}

export const HOTKEYS_OK: HotkeyStatus = {
  assistant: { accelerator: 'Ctrl+Shift+Space', registered: true },
  circle: { accelerator: 'Alt+Shift+C', registered: true },
  capture: { accelerator: 'Alt+Shift+S', registered: true },
  dictation: { accelerator: 'Alt+Shift+D', registered: true },
};

/** A `Bridge<'onboarding'>` with sensible answers; tests override single channels. */
export function createFakeBridge(): FakeBridge {
  const calls: FakeBridge['calls'] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let settings = settingsView();

  const handlers = new Map<string, Handler>([
    ['app:info', () => APP_INFO],
    ['app:log', () => undefined],
    ['settings:get', () => settings],
    [
      'settings:update',
      (patch) => {
        settings = {
          ...applySettingsPatch(settings, patch as SettingsPatch),
          secrets: settings.secrets,
        };
        return settings;
      },
    ],
    ['hotkeys:status', () => HOTKEYS_OK],
    ['voice:modelStatus', () => modelState()],
    ['voice:modelEnsure', () => modelState({ state: 'downloading' })],
    ['voice:modelCancel', () => modelState({ state: 'partial', receivedBytes: 4_000_000 })],
    ['os:openMicSettings', () => true],
    ['onboarding:finish', () => undefined],
  ]);

  const bridge = {
    role: 'onboarding',
    invoke: (channel: string, input?: unknown): Promise<unknown> => {
      calls.push({ channel, input });
      const handler = handlers.get(channel);
      if (!handler) return Promise.reject(new Error(`No fake handler for ${channel}`));
      try {
        return Promise.resolve(handler(input));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener);
      };
    },
  } as unknown as Bridge<Role>;

  return {
    bridge,
    calls,
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    emit: (channel, payload) => {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
    },
    inputsOf: (channel) => calls.filter((call) => call.channel === channel).map((c) => c.input),
    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
  };
}

export interface FakeMic {
  session: MicSession;
  /** RMS the next `readLevel()` returns. */
  level: { value: number };
  /** Called by `session.stop()`; assert on it to prove the microphone was released. */
  stop: ReturnType<typeof vi.fn>;
}

export function createFakeMic(): FakeMic {
  const level = { value: 0 };
  const stop = vi.fn();
  const session: MicSession = {
    sampleRate: 16_000,
    readLevel: () => level.value,
    onSamples: () => undefined,
    stop: () => {
      stop();
    },
  };
  return { session, level, stop };
}

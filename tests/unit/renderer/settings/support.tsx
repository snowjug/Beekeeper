import { act, configure, render, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import type { Bridge } from '@shared/ipc/bridge';
import type { EventChannelFor, InvokeChannelFor } from '@shared/ipc/channels';
import type { EventPayload, InvokeInput, InvokeOutput } from '@shared/ipc/schemas';
import type { AppInfo, HotkeyStatus, VoiceModelState } from '@shared/ipc/types';
import { DEFAULT_SETTINGS, type SettingsPatch, type SettingsView } from '@shared/settings';
import { useToastStore } from '@renderer/components/Toast';
import { SettingsController } from '@renderer/settings/controller';
import { SettingsProvider } from '@renderer/settings/context';
import type { SettingsPage } from '@renderer/settings/lib/nav';
import { applyPatch } from '@renderer/settings/lib/patch';
import { createSettingsStore } from '@renderer/settings/store';

type SettingsChannel = InvokeChannelFor<'settings'>;
type SettingsEvent = EventChannelFor<'settings'>;

// Page transitions run real (short) animations; leave room for a busy CI machine.
configure({ asyncUtilTimeout: 3000 });

export type Handlers = {
  [C in SettingsChannel]?: (input: InvokeInput<C>) => InvokeOutput<C> | Promise<InvokeOutput<C>>;
};

export interface Call {
  channel: string;
  input: unknown;
}

export interface FakeBridge {
  bridge: Bridge<'settings'>;
  calls: Call[];
  /** Inputs of every call made to `channel`, in order. */
  inputsOf: (channel: SettingsChannel) => unknown[];
  emit: <C extends SettingsEvent>(channel: C, payload: EventPayload<C>) => void;
}

/** A typed stand-in for window.beekeeper: records calls, answers from `handlers`, emits events. */
export function createFakeBridge(handlers: Handlers): FakeBridge {
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const invoke = (channel: SettingsChannel, input?: unknown): Promise<unknown> => {
    calls.push({ channel, input });
    const handler = handlers[channel] as ((value: unknown) => unknown) | undefined;
    if (!handler) return Promise.reject(new Error(`No fake handler for ${channel}`));
    try {
      return Promise.resolve(handler(input));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const on = (channel: string, listener: (payload: unknown) => void): (() => void) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(listener);
    listeners.set(channel, set);
    return () => {
      set.delete(listener);
    };
  };

  return {
    bridge: { role: 'settings', invoke, on } as unknown as Bridge<'settings'>,
    calls,
    inputsOf: (channel) =>
      calls.filter((call) => call.channel === channel).map((call) => call.input),
    emit: (channel, payload) => {
      act(() => {
        for (const listener of listeners.get(channel) ?? []) listener(payload);
      });
    },
  };
}

export function makeView(mutate?: (view: SettingsView) => void): SettingsView {
  const view: SettingsView = {
    ...structuredClone(DEFAULT_SETTINGS),
    secrets: { speechKey: null, openAiKey: null, elevenLabsKey: null },
  };
  mutate?.(view);
  return view;
}

export function makeInfo(overrides: Partial<AppInfo> = {}): AppInfo {
  return {
    name: 'Beekeeper',
    version: '1.0.0',
    platform: 'win32',
    electron: '45.2.1',
    chrome: '140.0.0.0',
    isPackaged: true,
    isDev: false,
    portable: false,
    material: 'mica',
    theme: 'dark',
    role: 'settings',
    osBuild: 26100,
    userDataPath: 'C:\\Users\\tester\\AppData\\Roaming\\Beekeeper',
    ...overrides,
  };
}

export function makeModel(overrides: Partial<VoiceModelState> = {}): VoiceModelState {
  return {
    state: 'ready',
    receivedBytes: 41_184_862,
    totalBytes: 41_184_862,
    bytesPerSecond: 0,
    etaSeconds: null,
    attempt: 1,
    maxAttempts: 1,
    modelUrl: 'beekeeper://app/models/model.tar.gz',
    displayName: 'English (US) speech model, small',
    ...overrides,
  };
}

export const HOTKEY_STATUS: HotkeyStatus = {
  assistant: { accelerator: 'Ctrl+Shift+Space', registered: true },
  circle: { accelerator: 'Alt+Shift+C', registered: true },
  capture: { accelerator: 'Alt+Shift+S', registered: true },
  dictation: { accelerator: 'Alt+Shift+D', registered: true },
};

/**
 * The bridge types `settings:update` input as `unknown` (the shared schema is cast without an input
 * type), so handlers narrow it here.
 */
export function asPatch(value: unknown): SettingsPatch {
  return value as SettingsPatch;
}

export interface StartOptions {
  view?: SettingsView;
  info?: AppInfo;
  model?: VoiceModelState;
  hotkeys?: HotkeyStatus;
  section?: SettingsPage;
  handlers?: Handlers;
}

export interface Harness extends FakeBridge {
  controller: SettingsController;
  /** What the fake main process currently holds. */
  main: { view: SettingsView };
  stop: () => void;
}

/** Boots a SettingsController against a fake main process (settings:update really patches). */
export async function startController(options: StartOptions = {}): Promise<Harness> {
  const main = { view: options.view ?? makeView() };
  const fake = createFakeBridge({
    'settings:get': () => main.view,
    'settings:update': (patch) => {
      main.view = applyPatch(main.view, asPatch(patch));
      return main.view;
    },
    'app:info': () => options.info ?? makeInfo(),
    'hotkeys:status': () => options.hotkeys ?? HOTKEY_STATUS,
    'voice:modelStatus': () => options.model ?? makeModel(),
    'updates:state': () => ({ status: 'idle' as const }),
    'app:log': () => undefined,
    ...options.handlers,
  });
  const controller = new SettingsController(fake.bridge, createSettingsStore(options.section));
  const stop = controller.start();
  await waitFor(() => expect(controller.store.getState().phase).toBe('ready'));
  await waitFor(() => expect(controller.store.getState().info).not.toBeNull());
  return { ...fake, controller, main, stop };
}

export function renderWithController(ui: ReactElement, controller: SettingsController) {
  return render(
    <MotionConfig reducedMotion="always">
      <SettingsProvider controller={controller}>{ui}</SettingsProvider>
    </MotionConfig>,
  );
}

export function clearToasts(): void {
  act(() => useToastStore.getState().clear());
}

export function toastTitles(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.title);
}

/** A promise the test resolves by hand, to hold a request "in flight". */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

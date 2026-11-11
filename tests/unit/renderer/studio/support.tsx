import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { vi } from 'vitest';
import type { Bridge } from '@shared/ipc/bridge';
import type { EventChannelFor, InvokeChannelFor } from '@shared/ipc/channels';
import type { EventPayload, InvokeInput, InvokeOutput } from '@shared/ipc/schemas';
import type { StudioActionResult, StudioSession, SynthesizeResult } from '@shared/ipc/types';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  type SettingsPatch,
  type SettingsView,
} from '@shared/settings';
import { App } from '@renderer/studio/App';
import { ControllerContext } from '@renderer/studio/context';
import { StudioController, type SpeechOutput } from '@renderer/studio/controller';
import type { Flattener, PngBytes } from '@renderer/studio/edit/flatten';
import { createStudioStore, type StudioStore } from '@renderer/studio/store';

type StudioChannel = InvokeChannelFor<'studio'>;
type StudioEvent = EventChannelFor<'studio'>;

export type Handlers = {
  [C in StudioChannel]?: (input: InvokeInput<C>) => InvokeOutput<C> | Promise<InvokeOutput<C>>;
};

export interface Call {
  channel: string;
  input: unknown;
}

export interface FakeBridge {
  bridge: Bridge<'studio'>;
  calls: Call[];
  /** Inputs of every call made to `channel`, in order. */
  inputsOf: (channel: StudioChannel) => unknown[];
  /** Replaces the answer of one channel. */
  handle: <C extends StudioChannel>(
    channel: C,
    handler: (input: InvokeInput<C>) => InvokeOutput<C> | Promise<InvokeOutput<C>>,
  ) => void;
  emit: <C extends StudioEvent>(channel: C, payload: EventPayload<C>) => void;
  listenerCount: (channel: string) => number;
}

/** A typed stand-in for window.beekeeper of the Studio page: records calls, answers from `handlers`. */
export function createFakeBridge(handlers: Handlers = {}): FakeBridge {
  const calls: Call[] = [];
  const answers = new Map<string, (input: unknown) => unknown>(
    Object.entries(handlers) as Array<[string, (input: unknown) => unknown]>,
  );
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const invoke = (channel: string, input?: unknown): Promise<unknown> => {
    calls.push({ channel, input });
    const handler = answers.get(channel);
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
    bridge: { role: 'studio', invoke, on } as unknown as Bridge<'studio'>,
    calls,
    inputsOf: (channel) =>
      calls.filter((call) => call.channel === channel).map((call) => call.input),
    handle: (channel, handler) => {
      answers.set(channel, handler as (input: unknown) => unknown);
    },
    emit: (channel, payload) => {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
    },
    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
  };
}

export const SAVED_PATH =
  'C:\\Users\\tester\\Pictures\\Beekeeper\\Beekeeper 2026-11-11 13.45.12.png';

export function makeSession(overrides: Partial<StudioSession> = {}): StudioSession {
  return {
    id: 'session-1',
    imageUrl: 'beekeeper://app/capture/session-1.png',
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    savedPath: SAVED_PATH,
    source: 'hotkey',
    createdAt: 1_700_000_000_000,
    display: { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    aiAvailable: false,
    glowFrame: true,
    dismissAfterSeconds: 0,
    theme: 'dark',
    ...overrides,
  };
}

export function makeSettings(patch: SettingsPatch = {}): SettingsView {
  return {
    ...applySettingsPatch(DEFAULT_SETTINGS, patch),
    secrets: { speechKey: null, openAiKey: null, elevenLabsKey: null },
  };
}

export function fakeImage(width = 1920, height = 1080): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

export const EDITED_BYTES: PngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

const OK: StudioActionResult = { ok: true };

/** Answers for every channel of the Studio page; tests override single ones. */
export function defaultHandlers(settings: SettingsView = makeSettings()): Handlers {
  return {
    'settings:get': () => settings,
    'app:log': () => undefined,
    'studio:getSession': () => null,
    'studio:ready': () => undefined,
    'studio:activity': () => undefined,
    'studio:copy': () => ({ ...OK, message: 'Copied to clipboard' }),
    'studio:copyText': () => OK,
    'studio:searchText': () => OK,
    'studio:save': () => ({ ...OK, path: SAVED_PATH, message: 'Saved' }),
    'studio:pin': () => OK,
    'studio:wallpaper': () => OK,
    'studio:share': () => OK,
    'studio:assist': (input) => ({ ok: true, task: input.task }),
    'studio:delete': () => ({ ...OK, message: 'Moved to the Recycle Bin' }),
    'studio:openFolder': () => true,
    'studio:close': () => undefined,
    'capture:start': () => undefined,
    'window:openSettings': () => undefined,
    'speech:synthesize': () => {
      throw new Error('speech is not available');
    },
  };
}

export interface FakePlayer extends SpeechOutput {
  play: ReturnType<typeof vi.fn<(result: SynthesizeResult) => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
}

export function createFakePlayer(): FakePlayer {
  return {
    play: vi.fn((_result: SynthesizeResult) => Promise.resolve()),
    stop: vi.fn(),
    dispose: vi.fn(() => Promise.resolve()),
  };
}

export interface Harness extends FakeBridge {
  controller: StudioController;
  store: StudioStore;
  decode: ReturnType<typeof vi.fn<(url: string) => Promise<HTMLImageElement>>>;
  flatten: ReturnType<typeof vi.fn<Flattener>>;
  player: FakePlayer;
  shutter: {
    play: ReturnType<typeof vi.fn<() => void>>;
    dispose: ReturnType<typeof vi.fn<() => void>>;
  };
  createObjectUrl: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
  revokeObjectUrl: ReturnType<typeof vi.fn<(url: string) => void>>;
}

export interface HarnessOptions {
  handlers?: Handlers;
  settings?: SettingsView;
  image?: { width: number; height: number };
}

/** A controller wired to a fake bridge, fake decoding, a fake flattener and fake audio. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const fake = createFakeBridge({
    ...defaultHandlers(options.settings),
    ...options.handlers,
  });
  const store = createStudioStore();
  const image = options.image ?? { width: 1920, height: 1080 };
  const decode = vi.fn((_url: string) => Promise.resolve(fakeImage(image.width, image.height)));
  const flatten = vi.fn<Flattener>(() => Promise.resolve(EDITED_BYTES));
  const player = createFakePlayer();
  const shutter = { play: vi.fn(), dispose: vi.fn() };
  let urls = 0;
  const createObjectUrl = vi.fn((_blob: Blob) => `blob:edited-${(urls += 1)}`);
  const revokeObjectUrl = vi.fn((_url: string) => undefined);
  const controller = new StudioController(fake.bridge, {
    store,
    decode,
    flatten,
    player,
    shutter,
    createObjectUrl,
    revokeObjectUrl,
  });
  return {
    ...fake,
    controller,
    store,
    decode,
    flatten,
    player,
    shutter,
    createObjectUrl,
    revokeObjectUrl,
  };
}

/** A promise the test resolves by hand, to hold a request "in flight". */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Renders the Studio page over a harness and opens a capture, ready for interaction. */
export async function renderStudio(
  options: HarnessOptions & { session?: StudioSession } = {},
): Promise<Harness & { user: ReturnType<typeof userEvent.setup> }> {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const harness = createHarness(options);
  render(
    <MotionConfig reducedMotion="always">
      <ControllerContext.Provider value={harness.controller}>
        <App />
      </ControllerContext.Provider>
    </MotionConfig>,
  );
  await act(async () => {
    await harness.controller.start();
    await harness.controller.onSession(options.session ?? makeSession());
  });
  return { ...harness, user: userEvent.setup() };
}

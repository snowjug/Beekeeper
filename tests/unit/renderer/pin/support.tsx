import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Bridge } from '@shared/ipc/bridge';
import type { EventChannelFor, InvokeChannelFor } from '@shared/ipc/channels';
import type { EventPayload, InvokeInput, InvokeOutput } from '@shared/ipc/schemas';
import type { AppInfo, PinInfo } from '@shared/ipc/types';
import { App } from '@renderer/pin/App';
import { PinControllerContext } from '@renderer/pin/context';
import { createPinStore, PinController, type PinStore } from '@renderer/pin/controller';

type PinChannel = InvokeChannelFor<'pin'>;
type PinEvent = EventChannelFor<'pin'>;

export type Handlers = {
  [C in PinChannel]?: (input: InvokeInput<C>) => InvokeOutput<C> | Promise<InvokeOutput<C>>;
};

export interface Call {
  channel: string;
  input: unknown;
}

export interface FakeBridge {
  bridge: Bridge<'pin'>;
  calls: Call[];
  /** Inputs of every call made to `channel`, in order. */
  inputsOf: (channel: PinChannel) => unknown[];
  /** The `pin:action` requests, in order. */
  actions: () => Array<{ type: string } & Record<string, unknown>>;
  handle: <C extends PinChannel>(
    channel: C,
    handler: (input: InvokeInput<C>) => InvokeOutput<C> | Promise<InvokeOutput<C>>,
  ) => void;
  emit: <C extends PinEvent>(channel: C, payload: EventPayload<C>) => void;
  listenerCount: (channel: string) => number;
}

/** A typed stand-in for window.beekeeper of a pin page: records calls, answers from `handlers`. */
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
  const inputsOf = (channel: string): unknown[] =>
    calls.filter((call) => call.channel === channel).map((call) => call.input);

  return {
    bridge: { role: 'pin', invoke, on } as unknown as Bridge<'pin'>,
    calls,
    inputsOf,
    actions: () => inputsOf('pin:action') as Array<{ type: string } & Record<string, unknown>>,
    handle: (channel, handler) => {
      answers.set(channel, handler as (input: unknown) => unknown);
    },
    emit: (channel, payload) => {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
    },
    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
  };
}

export interface LogEntry {
  level: string;
  scope: string;
  message: string;
}

/** What the page wrote to the app log (`app:log`), in order. */
export function logsOf(fake: FakeBridge): LogEntry[] {
  return fake.inputsOf('app:log') as LogEntry[];
}

export function makeInfo(overrides: Partial<PinInfo> = {}): PinInfo {
  return {
    id: 'pin-1',
    imageUrl: 'beekeeper://app/capture/pin-1.png',
    width: 1920,
    height: 1080,
    scale: 0.4,
    opacity: 1,
    clickThrough: false,
    ...overrides,
  };
}

export const APP_INFO: AppInfo = {
  name: 'Beekeeper',
  version: '1.1.0',
  platform: 'win32',
  electron: '45.0.0',
  chrome: '140.0.0',
  isPackaged: false,
  isDev: true,
  portable: false,
  material: 'mica',
  theme: 'light',
  role: 'pin',
  osBuild: 26100,
  userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\Beekeeper',
};

/** Answers for every channel of a pin page; tests override single ones. */
export function defaultHandlers(info: PinInfo | null = makeInfo()): Handlers {
  return {
    'pin:getInfo': () => info,
    'pin:action': () => undefined,
    'app:info': () => APP_INFO,
    'app:log': () => undefined,
  };
}

/** Animation frames the test releases by hand, so coalescing is deterministic. */
export interface FrameQueue {
  frame: (callback: () => void) => () => void;
  /** Runs every callback queued so far. */
  flush: () => void;
  readonly pending: number;
}

export function createFrameQueue(): FrameQueue {
  let queue: Array<{ id: number; run: () => void }> = [];
  let next = 0;
  return {
    frame: (run) => {
      const id = (next += 1);
      queue.push({ id, run });
      return () => {
        queue = queue.filter((entry) => entry.id !== id);
      };
    },
    flush: () => {
      const batch = queue;
      queue = [];
      for (const entry of batch) entry.run();
    },
    get pending() {
      return queue.length;
    },
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

/** Lets promise callbacks (and the controller's `await`s) run. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface Harness extends FakeBridge {
  controller: PinController;
  store: PinStore;
  frames: FrameQueue;
}

export interface HarnessOptions {
  handlers?: Handlers;
  /** What `pin:getInfo` answers (default: a fresh pin; null = the window is unknown). */
  info?: PinInfo | null;
  feedbackMs?: number;
}

const created: PinController[] = [];

/** Stops every controller the tests started (their timers must not outlive the test). */
export function disposeControllers(): void {
  for (const controller of created.splice(0)) controller.dispose();
}

/** A controller wired to a fake bridge and a hand-driven frame queue. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const info = options.info === undefined ? makeInfo() : options.info;
  const fake = createFakeBridge({ ...defaultHandlers(info), ...options.handlers });
  const store = createPinStore();
  const frames = createFrameQueue();
  const controller = new PinController(fake.bridge, {
    store,
    frame: frames.frame,
    feedbackMs: options.feedbackMs ?? 25,
  });
  created.push(controller);
  return { ...fake, controller, store, frames };
}

/** Renders the pin page over a harness and starts it. */
export async function renderPin(
  options: HarnessOptions = {},
): Promise<Harness & { user: ReturnType<typeof userEvent.setup>; unmount: () => void }> {
  // A confirmation icon must still be there when the test looks at it.
  const harness = createHarness({ feedbackMs: 5000, ...options });
  const view = render(
    <PinControllerContext.Provider value={harness.controller}>
      <App />
    </PinControllerContext.Provider>,
  );
  await act(async () => {
    await harness.controller.start();
  });
  return { ...harness, user: userEvent.setup(), unmount: view.unmount };
}

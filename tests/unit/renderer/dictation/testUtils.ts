import { vi } from 'vitest';
import type { Bridge } from '@shared/ipc/bridge';
import type { EventChannelFor, InvokeChannelFor } from '@shared/ipc/channels';
import type { EventPayload } from '@shared/ipc/schemas';
import type { MicSession } from '@renderer/lib/voice/mic';

type Role = 'dictation';
type Handler = (input: unknown) => unknown;

export interface FakeBridge {
  bridge: Bridge<Role>;
  /** Every invoke so far (oldest first). */
  calls: Array<{ channel: string; input: unknown }>;
  /** Replaces the answer of one channel; a thrown error rejects the invoke. */
  handle: (channel: InvokeChannelFor<Role>, handler: Handler) => void;
  /** Delivers a main-process event to the page. */
  emit: <C extends EventChannelFor<Role>>(channel: C, payload: EventPayload<C>) => void;
  inputsOf: (channel: InvokeChannelFor<Role>) => unknown[];
  listenerCount: (channel: string) => number;
}

export function createFakeBridge(): FakeBridge {
  const calls: FakeBridge['calls'] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const handlers = new Map<string, Handler>([
    ['dictation:ready', () => undefined],
    ['dictation:submit', () => ({ ok: true })],
    ['dictation:cancel', () => undefined],
    ['dictation:abort', () => undefined],
    ['app:log', () => undefined],
  ]);

  const bridge = {
    role: 'dictation',
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
  stop: ReturnType<typeof vi.fn>;
  /** Delivers a chunk the way the AudioWorklet does. */
  push: (chunk: Float32Array, sampleRate?: number) => void;
}

export function createFakeMic(sampleRate = 16_000): FakeMic {
  const level = { value: 0 };
  const stop = vi.fn();
  let listener: ((samples: Float32Array, rate: number) => void) | null = null;
  const session: MicSession = {
    sampleRate,
    readLevel: () => level.value,
    onSamples: (next) => {
      listener = next;
    },
    stop: () => {
      stop();
    },
  };
  return {
    session,
    level,
    stop,
    push: (chunk, rate = sampleRate) => listener?.(chunk, rate),
  };
}

/** One 100 ms chunk at 16 kHz: a loud tone (speech) or digital silence. */
export function chunk(kind: 'speech' | 'silence', rate = 16_000, ms = 100): Float32Array {
  const samples = new Float32Array(Math.round((rate * ms) / 1000));
  if (kind === 'silence') return samples;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / rate);
  }
  return samples;
}

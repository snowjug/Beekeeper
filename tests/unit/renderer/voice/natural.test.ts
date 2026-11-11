import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SynthesizeResult } from '@shared/ipc/types';

const hoisted = vi.hoisted(() => ({
  enqueue: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@renderer/lib/voice/player', () => ({
  SpeechPlayer: class {
    enqueue = hoisted.enqueue;
    stop = hoisted.stop;
    dispose = hoisted.dispose;
  },
}));

const { NaturalSpeaker } = await import('@renderer/assistant/voice/natural');

function audio(label: string): SynthesizeResult {
  return {
    format: 'f32',
    sampleRate: 44_100,
    data: new ArrayBuffer(4),
    durationMs: 100,
    engine: 'natural',
    lang: 'en',
    elapsedMs: label.length,
  };
}

interface Deferred {
  resolve: (value: SynthesizeResult) => void;
  reject: (error: Error) => void;
  input: { text: string; lang: string };
}

/** A bridge whose synthesis results are resolved by the test, in any order. */
function controlledBridge() {
  const requests: Deferred[] = [];
  const invoke = vi.fn((_channel: string, input: { text: string; lang: string }) => {
    return new Promise<SynthesizeResult>((resolve, reject) => {
      requests.push({ resolve, reject, input });
    });
  });
  return { invoke, requests };
}

function callbacks() {
  return { onStart: vi.fn(), onBoundary: vi.fn(), onEnd: vi.fn() };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  hoisted.enqueue.mockReset().mockImplementation(() => Promise.resolve());
  hoisted.stop.mockReset();
  hoisted.dispose.mockReset().mockResolvedValue(undefined);
});

describe('NaturalSpeaker', () => {
  it('plays a reply sentence by sentence and reports start, boundaries and end', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const cb = callbacks();
    const done = speaker.speak('It is sunny today. Take an umbrella anyway.', cb);

    await flush();
    expect(bridge.requests.map((request) => request.input)).toEqual([
      { text: 'It is sunny today.', lang: 'en' },
      { text: 'Take an umbrella anyway.', lang: 'en' },
    ]);
    expect(cb.onStart).not.toHaveBeenCalled();

    bridge.requests[0]?.resolve(audio('a'));
    await flush();
    expect(cb.onStart).toHaveBeenCalledTimes(1);
    expect(hoisted.enqueue).toHaveBeenCalledTimes(1);

    bridge.requests[1]?.resolve(audio('b'));
    await done;
    expect(hoisted.enqueue).toHaveBeenCalledTimes(2);
    expect(cb.onBoundary).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(speaker.speaking).toBe(false);
  });

  it('only synthesises two sentences ahead', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const done = speaker.speak(
      'The first sentence is long enough. The second sentence is long enough. The third sentence is long enough. The fourth sentence is long enough.',
      callbacks(),
    );
    await flush();
    expect(bridge.requests).toHaveLength(2);

    bridge.requests[0]?.resolve(audio('1'));
    await flush();
    expect(bridge.requests).toHaveLength(3);
    bridge.requests[1]?.resolve(audio('2'));
    await flush();
    expect(bridge.requests).toHaveLength(4);
    bridge.requests[2]?.resolve(audio('3'));
    bridge.requests[3]?.resolve(audio('4'));
    await done;
    expect(hoisted.enqueue).toHaveBeenCalledTimes(4);
  });

  it('speaks Hindi and English parts with the right language', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    void speaker.speak('आज मौसम साफ़ है। It is sunny.', callbacks());
    await flush();
    expect(bridge.requests.map((request) => request.input.lang)).toEqual(['hi', 'en']);
  });

  it('rejects when the first sentence cannot be synthesised, so the caller can fall back', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const cb = callbacks();
    const done = speaker.speak('Hello there my friend.', cb);
    await flush();
    bridge.requests[0]?.reject(new Error('The natural voice is not installed.'));
    await expect(done).rejects.toThrow('not installed');
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onStart).not.toHaveBeenCalled();
    expect(hoisted.enqueue).not.toHaveBeenCalled();
  });

  it('finishes what already plays when a later sentence fails', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const cb = callbacks();
    const done = speaker.speak('First sentence is fine. Second sentence breaks.', cb);
    await flush();
    bridge.requests[0]?.resolve(audio('1'));
    bridge.requests[1]?.reject(new Error('engine busy'));
    await expect(done).resolves.toBeUndefined();
    expect(hoisted.enqueue).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops playback, fires the end callback once and ignores late results', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const cb = callbacks();
    const done = speaker.speak(
      'The first sentence is long enough. The second sentence is long enough.',
      cb,
    );
    await flush();
    bridge.requests[0]?.resolve(audio('1'));
    await flush();

    speaker.cancel();
    expect(hoisted.stop).toHaveBeenCalled();
    expect(cb.onEnd).toHaveBeenCalledTimes(1);

    bridge.requests[1]?.resolve(audio('2'));
    await done;
    expect(hoisted.enqueue).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
  });

  it('starting a new reply cancels the previous one', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const first = callbacks();
    void speaker.speak('The first reply is long.', first);
    await flush();
    const second = callbacks();
    void speaker.speak('A second reply.', second);
    await flush();
    expect(first.onEnd).toHaveBeenCalledTimes(1);
    expect(bridge.requests.at(-1)?.input.text).toBe('A second reply.');
  });

  it('has nothing to say for text without words', async () => {
    const bridge = controlledBridge();
    const speaker = new NaturalSpeaker(bridge as never);
    const cb = callbacks();
    await speaker.speak('**', cb);
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(cb.onStart).not.toHaveBeenCalled();
  });

  it('releases the player on dispose', async () => {
    const speaker = new NaturalSpeaker(controlledBridge() as never);
    await speaker.dispose();
    expect(hoisted.dispose).toHaveBeenCalled();
  });
});

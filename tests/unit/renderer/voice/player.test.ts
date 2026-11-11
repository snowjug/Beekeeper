import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SynthesizeResult } from '@shared/ipc/types';
import { SpeechPlayer } from '@renderer/lib/voice/player';

class FakeParam {
  readonly calls: Array<[string, number, number]> = [];
  setValueAtTime(value: number, time: number): void {
    this.calls.push(['set', value, time]);
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push(['ramp', value, time]);
  }
}

class FakeNode {
  connect = vi.fn((target: unknown) => target);
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  starts: number[] = [];
  stopped = false;
  start(when: number): void {
    this.starts.push(when);
  }
  stop(): void {
    this.stopped = true;
  }
}

let contexts: FakeContext[] = [];

class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 10;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly decode = vi.fn((_data: ArrayBuffer) => Promise.resolve({ duration: 2 }));
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  constructor() {
    contexts.push(this);
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: vi.fn() };
  }
  decodeAudioData(data: ArrayBuffer) {
    return this.decode(data);
  }
}

function pcm(seconds: number, rate = 44_100): SynthesizeResult {
  return {
    format: 'f32',
    sampleRate: rate,
    data: new Float32Array(Math.round(seconds * rate)).buffer,
    durationMs: seconds * 1000,
    engine: 'natural',
    lang: 'en',
    elapsedMs: 5,
  };
}

beforeEach(() => {
  contexts = [];
  vi.stubGlobal('AudioContext', FakeContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SpeechPlayer', () => {
  it('schedules clips back to back so sentences sound continuous', async () => {
    const player = new SpeechPlayer();
    const first = player.enqueue(pcm(1));
    const second = player.enqueue(pcm(0.5));
    await vi.waitFor(() => expect(contexts[0]?.sources).toHaveLength(2));

    const [a, b] = contexts[0]?.sources ?? [];
    expect(a?.starts[0]).toBeCloseTo(10.02);
    expect(b?.starts[0]).toBeCloseTo(11.02); // right after the first one ends
    expect(player.speaking).toBe(true);

    a?.onended?.();
    b?.onended?.();
    await Promise.all([first, second]);
    expect(player.speaking).toBe(false);
  });

  it('fades each clip in and out to avoid clicks', async () => {
    const player = new SpeechPlayer();
    void player.enqueue(pcm(1), 0.8);
    await vi.waitFor(() => expect(contexts[0]?.gains).toHaveLength(1));
    const calls = contexts[0]?.gains[0]?.gain.calls ?? [];
    expect(calls[0]).toEqual(['set', 0, expect.closeTo(10.02, 3)]);
    expect(calls.at(-1)?.[1]).toBe(0);
    expect(calls.some((call) => call[0] === 'ramp' && call[1] === 0.8)).toBe(true);
  });

  it('decodes mp3 audio from ElevenLabs', async () => {
    const player = new SpeechPlayer();
    const mp3: SynthesizeResult = {
      ...pcm(1),
      format: 'mp3',
      data: new Uint8Array([1, 2, 3]).buffer,
      engine: 'elevenlabs',
    };
    void player.enqueue(mp3);
    await vi.waitFor(() => expect(contexts[0]?.decode).toHaveBeenCalledTimes(1));
    // The original buffer stays usable (decodeAudioData detaches what it gets).
    expect(mp3.data.byteLength).toBe(3);
  });

  it('stop() ends everything that is playing or queued', async () => {
    const player = new SpeechPlayer();
    const clips = [player.enqueue(pcm(1)), player.enqueue(pcm(1))];
    await vi.waitFor(() => expect(contexts[0]?.sources).toHaveLength(2));
    player.stop();
    await Promise.all(clips);
    expect(contexts[0]?.sources.every((source) => source.stopped)).toBe(true);
    expect(player.speaking).toBe(false);
  });

  it('play() replaces what is playing', async () => {
    const player = new SpeechPlayer();
    const old = player.enqueue(pcm(5));
    await vi.waitFor(() => expect(contexts[0]?.sources).toHaveLength(1));
    void player.play(pcm(1));
    await old;
    expect(contexts[0]?.sources[0]?.stopped).toBe(true);
  });

  it('wakes a suspended audio context', async () => {
    const player = new SpeechPlayer();
    void player.enqueue(pcm(1));
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    contexts[0]!.state = 'suspended';
    void player.enqueue(pcm(1));
    await vi.waitFor(() => expect(contexts[0]?.resume).toHaveBeenCalled());
  });

  it('releases the audio device on dispose', async () => {
    const player = new SpeechPlayer();
    void player.enqueue(pcm(1));
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    await player.dispose();
    expect(contexts[0]?.close).toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAIL_GRACE_MS, DictationPillController } from '@renderer/dictation/controller';
import { resetPillStore, usePillStore } from '@renderer/dictation/store';
import { MicError, type MicSession } from '@renderer/lib/voice/mic';
import type { DictationStart } from '@shared/ipc/types';
import { chunk, createFakeBridge, createFakeMic } from './testUtils';

const START: DictationStart = {
  language: 'en',
  micDeviceId: 'usb-mic',
  silenceMs: 800,
  maxSeconds: 60,
  earcons: false,
  theme: 'light',
  hotkey: 'Alt+Shift+D',
};

let frames: Array<(now: number) => void> = [];

function setup(options: { openMic?: (deviceId: string) => Promise<MicSession> } = {}) {
  const fake = createFakeBridge();
  const mic = createFakeMic();
  const openMic = vi.fn(options.openMic ?? ((_deviceId: string) => Promise.resolve(mic.session)));
  const play = vi.fn();
  const dispose = vi.fn();
  const controller = new DictationPillController({
    bridge: fake.bridge,
    openMic,
    earcons: { play, dispose },
  });
  const stop = controller.start();
  return { fake, mic, openMic, play, dispose, controller, stop };
}

type Harness = ReturnType<typeof setup>;

/** Lets the microphone finish opening. */
async function begin(harness: Harness, patch: Partial<DictationStart> = {}): Promise<void> {
  harness.fake.emit('dictation:start', { ...START, ...patch });
  await vi.advanceTimersByTimeAsync(0);
}

const feed = (harness: Harness, kind: 'speech' | 'silence', count: number): void => {
  for (let index = 0; index < count; index += 1) harness.mic.push(chunk(kind));
};

const submitted = (harness: Harness): Array<{ samples: Float32Array }> =>
  harness.fake.inputsOf('dictation:submit') as Array<{ samples: Float32Array }>;

/** A microphone that opens only when the test says so. */
function slowMic(): { openMic: () => Promise<MicSession>; open: (session: MicSession) => void } {
  let open: (session: MicSession) => void = () => undefined;
  return {
    openMic: () =>
      new Promise<MicSession>((resolve) => {
        open = resolve;
      }),
    open: (session) => open(session),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  resetPillStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['theme'];
});

describe('starting', () => {
  it('subscribes first and then tells the main process that the page is ready', () => {
    const { fake } = setup();
    expect(fake.listenerCount('dictation:start')).toBe(1);
    expect(fake.listenerCount('dictation:stop')).toBe(1);
    expect(fake.listenerCount('dictation:status')).toBe(1);
    expect(fake.inputsOf('dictation:ready')).toHaveLength(1);
  });

  it('shows the pill, opens the chosen microphone and applies the theme', async () => {
    const harness = setup();
    await begin(harness, { language: 'hi', hotkey: null });

    expect(harness.openMic).toHaveBeenCalledWith('usb-mic');
    const state = usePillStore.getState();
    expect(state).toMatchObject({
      visible: true,
      phase: 'listening',
      preparing: false,
      speaking: false,
      language: 'hi',
      hotkey: null,
    });
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('plays the start sound only when earcons are on', async () => {
    const quiet = setup();
    await begin(quiet);
    expect(quiet.play).not.toHaveBeenCalled();

    const loud = setup();
    await begin(loud, { earcons: true });
    expect(loud.play).toHaveBeenCalledWith('start');
  });

  it('shows that the speaker is talking once speech is heard', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'silence', 3);
    expect(usePillStore.getState().speaking).toBe(false);
    feed(harness, 'speech', 3);
    expect(usePillStore.getState().speaking).toBe(true);
  });

  it('smooths the microphone level for the waveform', async () => {
    const harness = setup();
    await begin(harness);
    harness.mic.level.value = 0.1;
    const base = performance.now();
    for (let step = 1; step <= 10; step += 1) frames.shift()?.(base + step * 16);
    expect(harness.controller.levelRef.current).toBeGreaterThan(0.3);
    expect(harness.controller.levelRef.current).toBeLessThanOrEqual(0.6);
  });

  it.each([
    ['denied', 'mic-denied'],
    ['no-device', 'mic-missing'],
    ['busy', 'mic-busy'],
    ['unknown', 'error'],
  ] as const)('reports a %s microphone as %s', async (kind, reason) => {
    const harness = setup({ openMic: () => Promise.reject(new MicError(kind, 'blocked')) });
    await begin(harness, { earcons: true });
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([{ reason, message: 'blocked' }]);
    expect(harness.play).toHaveBeenCalledWith('error');
  });

  it('reports any other failure as an error', async () => {
    const harness = setup({ openMic: () => Promise.reject(new Error('boom')) });
    await begin(harness);
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([
      { reason: 'error', message: 'boom' },
    ]);
  });

  it('says the microphone is getting ready until it has opened', async () => {
    const slow = slowMic();
    const mic = createFakeMic();
    const harness = setup({ openMic: slow.openMic });
    harness.fake.emit('dictation:start', START);
    await vi.advanceTimersByTimeAsync(0);
    expect(usePillStore.getState()).toMatchObject({ visible: true, preparing: true });

    slow.open(mic.session);
    await vi.advanceTimersByTimeAsync(0);
    expect(usePillStore.getState().preparing).toBe(false);
  });

  it('lets go of a microphone that opened after the dictation was cancelled', async () => {
    const slow = slowMic();
    const mic = createFakeMic();
    const harness = setup({ openMic: slow.openMic });
    harness.fake.emit('dictation:start', START);
    await vi.advanceTimersByTimeAsync(0);
    harness.controller.cancel();
    slow.open(mic.session);
    await vi.advanceTimersByTimeAsync(0);
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });
});

describe('while the microphone is still opening', () => {
  async function opening() {
    const slow = slowMic();
    const mic = createFakeMic();
    const harness = setup({ openMic: slow.openMic });
    harness.fake.emit('dictation:start', { ...START, earcons: true });
    await vi.advanceTimersByTimeAsync(0);
    const open = async (): Promise<void> => {
      slow.open(mic.session);
      await vi.advanceTimersByTimeAsync(0);
    };
    return { harness, mic, open };
  }

  it.each([
    [
      'the main process cancels',
      (h: Harness) => h.fake.emit('dictation:status', { phase: 'cancelled' }),
    ],
    [
      'the main process stops without a result',
      (h: Harness) => h.fake.emit('dictation:stop', { submit: false }),
    ],
    [
      'the main process reports a problem',
      (h: Harness) => h.fake.emit('dictation:status', { phase: 'error', message: 'No.' }),
    ],
  ])('lets go of the microphone when %s', async (_what, interrupt) => {
    const { harness, mic, open } = await opening();
    interrupt(harness);
    await open();
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(harness.play).not.toHaveBeenCalledWith('start');
    expect(submitted(harness)).toHaveLength(0);
  });

  it.each([
    ['the main process', (h: Harness) => h.fake.emit('dictation:stop', { submit: true })],
    ['the microphone button', (h: Harness) => h.controller.finishNow()],
  ])('finishes as soon as the microphone has opened when %s asks for it', async (_who, finish) => {
    const { harness, mic, open } = await opening();
    finish(harness);
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([]);

    await open();
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([{ reason: 'no-speech' }]);
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(harness.play).not.toHaveBeenCalledWith('start');
    expect(usePillStore.getState().preparing).toBe(false);
  });
});

describe('finishing', () => {
  it('hands the speech over when the speaker stops talking, and releases the microphone', async () => {
    const harness = setup();
    await begin(harness, { earcons: true });
    feed(harness, 'silence', 10);
    feed(harness, 'speech', 10);
    feed(harness, 'silence', 8);
    await vi.advanceTimersByTimeAsync(0);

    const [call] = submitted(harness);
    expect(submitted(harness)).toHaveLength(1);
    // 300 ms pre-roll + 1 s speech + 300 ms tail at 16 kHz.
    expect(call?.samples).toBeInstanceOf(Float32Array);
    expect(call?.samples.length).toBe(25_600);
    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
    expect(harness.play).toHaveBeenCalledWith('stop');
    expect(usePillStore.getState().phase).toBe('transcribing');
  });

  it('finishes when the main process says so, keeping a moment of tail so the last word is whole', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'speech', 6);
    harness.fake.emit('dictation:stop', { submit: true });
    // The last chunk still arrives during the grace period.
    harness.mic.push(chunk('speech'));
    expect(submitted(harness)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TAIL_GRACE_MS);

    expect(submitted(harness)).toHaveLength(1);
    // 7 chunks of speech + 300 ms of tail space that did not arrive.
    expect(submitted(harness)[0]?.samples.length).toBe(7 * 1600);
    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
  });

  it('submits once however often it is asked to finish', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'speech', 6);
    harness.fake.emit('dictation:stop', { submit: true });
    harness.controller.finishNow();
    feed(harness, 'silence', 8);
    await vi.advanceTimersByTimeAsync(TAIL_GRACE_MS);
    expect(submitted(harness)).toHaveLength(1);
  });

  it('finishes from the microphone button', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'speech', 6);
    harness.controller.finishNow();
    await vi.advanceTimersByTimeAsync(TAIL_GRACE_MS);
    expect(submitted(harness)).toHaveLength(1);
  });

  it('says nothing was heard when the button is pressed before anyone spoke', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'silence', 5);
    harness.controller.finishNow();
    await vi.advanceTimersByTimeAsync(TAIL_GRACE_MS);

    expect(submitted(harness)).toHaveLength(0);
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([{ reason: 'no-speech' }]);
    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
  });

  it('gives up after ten silent seconds', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'silence', 110);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([{ reason: 'no-speech' }]);
    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
  });

  it('stops at the longest allowed recording and submits it', async () => {
    const harness = setup();
    await begin(harness, { maxSeconds: 2 });
    feed(harness, 'speech', 25);
    await vi.advanceTimersByTimeAsync(0);
    expect(submitted(harness)).toHaveLength(1);
  });

  it('shows a problem when the main process cannot take the recording', async () => {
    const harness = setup();
    harness.fake.handle('dictation:submit', () => {
      throw new Error('IPC failed');
    });
    await begin(harness);
    feed(harness, 'speech', 5);
    feed(harness, 'silence', 8);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.fake.inputsOf('dictation:abort')).toEqual([
      { reason: 'error', message: 'IPC failed' },
    ]);
  });

  it('shows a message of its own when even the abort cannot be delivered', async () => {
    const harness = setup({ openMic: () => Promise.reject(new MicError('busy', 'busy')) });
    harness.fake.handle('dictation:abort', () => {
      throw new Error('gone');
    });
    await begin(harness);
    expect(usePillStore.getState()).toMatchObject({
      phase: 'error',
      message: 'Dictation hit a problem. Try again',
    });
  });
});

describe('cancelling', () => {
  it('releases the microphone, tells the main process and hides the pill', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'speech', 4);
    harness.controller.cancel();

    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
    expect(harness.fake.inputsOf('dictation:cancel')).toHaveLength(1);
    expect(usePillStore.getState()).toMatchObject({ visible: false, phase: 'cancelled' });

    feed(harness, 'silence', 10);
    await vi.advanceTimersByTimeAsync(500);
    expect(submitted(harness)).toHaveLength(0);
  });

  it('drops the recording without submitting when the main process stops it', async () => {
    const harness = setup();
    await begin(harness);
    feed(harness, 'speech', 4);
    harness.fake.emit('dictation:stop', { submit: false });
    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(submitted(harness)).toHaveLength(0);
  });

  it('can be cancelled before anything started', () => {
    const harness = setup();
    expect(() => harness.controller.cancel()).not.toThrow();
    expect(harness.fake.inputsOf('dictation:cancel')).toHaveLength(1);
  });

  it('is cancelled by the main process too', async () => {
    const harness = setup();
    await begin(harness);
    harness.fake.emit('dictation:status', { phase: 'cancelled' });
    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
    expect(usePillStore.getState().visible).toBe(false);
  });

  it('starts over when a new dictation begins while the last one is still recording', async () => {
    const first = createFakeMic();
    const second = createFakeMic();
    const mics = [first, second];
    const harness = setup({ openMic: () => Promise.resolve((mics.shift() ?? second).session) });
    await begin(harness);
    await begin(harness);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).not.toHaveBeenCalled();
  });
});

describe('what the main process reports', () => {
  it('shows the phases and hides the pill after the result', async () => {
    const harness = setup();
    await begin(harness);

    harness.fake.emit('dictation:status', { phase: 'typing', text: 'Hello world' });
    expect(usePillStore.getState()).toMatchObject({ phase: 'typing', text: 'Hello world' });

    harness.fake.emit('dictation:status', { phase: 'done', text: 'Hello world' });
    expect(usePillStore.getState().visible).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect(usePillStore.getState().visible).toBe(false);
  });

  it('keeps a message longer than a plain result', async () => {
    const harness = setup();
    harness.fake.emit('dictation:status', { phase: 'error', message: 'No microphone found.' });
    expect(usePillStore.getState()).toMatchObject({
      phase: 'error',
      message: 'No microphone found.',
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(usePillStore.getState().visible).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(usePillStore.getState().visible).toBe(false);
  });

  it('does not hide a new dictation because of the last result', async () => {
    const harness = setup();
    harness.fake.emit('dictation:status', { phase: 'done', text: 'a' });
    await vi.advanceTimersByTimeAsync(500);
    await begin(harness);
    await vi.advanceTimersByTimeAsync(2000);
    expect(usePillStore.getState().visible).toBe(true);
  });

  it('follows the theme of the system', () => {
    const harness = setup();
    harness.fake.emit('theme:changed', { theme: 'light' });
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

describe('cleanup', () => {
  it('unsubscribes, releases the microphone and the sounds', async () => {
    const harness = setup();
    await begin(harness);
    harness.stop();

    expect(harness.mic.stop).toHaveBeenCalledTimes(1);
    expect(harness.dispose).toHaveBeenCalledTimes(1);
    expect(harness.fake.listenerCount('dictation:start')).toBe(0);
    expect(harness.fake.listenerCount('dictation:status')).toBe(0);
  });
});

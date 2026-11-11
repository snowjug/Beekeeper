import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIC_ERROR_HELP, MicError, type MicSession } from '@renderer/lib/voice/mic';
import { useMicTest } from '@renderer/onboarding/hooks/useMicTest';
import { SILENT_TEXT } from '@renderer/onboarding/micCopy';
import type { OpenMic } from '@renderer/onboarding/micOpen';
import { createFakeMic, type FakeMic } from './testUtils';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(openMic?: OpenMic, mic: FakeMic = createFakeMic()) {
  const open = vi.fn<OpenMic>(openMic ?? (() => Promise.resolve(mic.session)));
  const announce = vi.fn<(text: string) => void>();
  const hook = renderHook(
    (props: { deviceId: string }) =>
      useMicTest({ openMic: open, deviceId: props.deviceId, announce }),
    { initialProps: { deviceId: 'default' } },
  );
  return { mic, open, announce, ...hook };
}

/** Lets `ms` of fake time pass (animation frames and timers fire) and flushes promises. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function startListening(hook: ReturnType<typeof setup>): Promise<void> {
  act(() => hook.result.current.start());
  await elapse(0);
}

describe('useMicTest', () => {
  it('opens the saved microphone and starts listening', async () => {
    const hook = setup();
    act(() => hook.result.current.start());
    expect(hook.result.current.state).toEqual({ status: 'requesting' });
    expect(hook.result.current.active).toBe(false);
    await elapse(0);
    expect(hook.open).toHaveBeenCalledWith('default');
    expect(hook.result.current.state).toEqual({ status: 'listening' });
    expect(hook.result.current.active).toBe(true);
    expect(hook.announce).toHaveBeenCalledWith('Listening. Say something.');
  });

  it('hears the user after about 400 ms and releases the microphone a second later', async () => {
    const hook = setup();
    await startListening(hook);
    hook.mic.level.value = 0.2;
    await elapse(300);
    expect(hook.result.current.state.status).toBe('listening');
    await elapse(250);
    expect(hook.result.current.state).toEqual({ status: 'heard' });
    expect(hook.result.current.outcome).toBe('heard');
    expect(hook.announce).toHaveBeenLastCalledWith('I can hear you.');
    expect(hook.result.current.levelRef.current).toBeGreaterThan(0.5);
    expect(hook.mic.stop).not.toHaveBeenCalled();
    expect(hook.result.current.active).toBe(true);

    await elapse(1000);
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.active).toBe(false);
    expect(hook.result.current.levelRef.current).toBe(0);
    expect(hook.result.current.state).toEqual({ status: 'heard' });

    await elapse(20_000);
    expect(hook.result.current.state).toEqual({ status: 'heard' });
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
  });

  it('gives up after 8 seconds of silence and releases the microphone', async () => {
    const hook = setup();
    await startListening(hook);
    await elapse(7900);
    expect(hook.result.current.state.status).toBe('listening');
    expect(hook.mic.stop).not.toHaveBeenCalled();
    await elapse(200);
    expect(hook.result.current.state).toEqual({ status: 'silent' });
    expect(hook.result.current.outcome).toBe('silent');
    expect(hook.result.current.active).toBe(false);
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.announce).toHaveBeenLastCalledWith(SILENT_TEXT);
  });

  it('ignores noise below the threshold', async () => {
    const hook = setup();
    await startListening(hook);
    hook.mic.level.value = 0.01;
    await elapse(5000);
    expect(hook.result.current.state.status).toBe('listening');
  });

  it('stop() releases at once and goes back to idle, but keeps a finished result', async () => {
    const hook = setup();
    await startListening(hook);
    act(() => hook.result.current.stop());
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toEqual({ status: 'idle' });
    expect(hook.result.current.active).toBe(false);

    const second = setup();
    await startListening(second);
    second.mic.level.value = 0.3;
    await elapse(600);
    expect(second.result.current.state.status).toBe('heard');
    act(() => second.result.current.stop());
    expect(second.mic.stop).toHaveBeenCalledTimes(1);
    expect(second.result.current.state).toEqual({ status: 'heard' });
  });

  it('releases a microphone that opens after the test was already stopped', async () => {
    let resolveOpen: (session: MicSession) => void = () => undefined;
    const hook = setup(
      () =>
        new Promise<MicSession>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    act(() => hook.result.current.start());
    act(() => hook.result.current.stop());
    expect(hook.result.current.state).toEqual({ status: 'idle' });
    await act(async () => {
      resolveOpen(hook.mic.session);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toEqual({ status: 'idle' });
    expect(hook.result.current.active).toBe(false);
  });

  it.each([
    [new MicError('denied', 'blocked'), 'denied'],
    [new MicError('no-device', 'none'), 'no-device'],
    [new MicError('busy', 'in use'), 'busy'],
    [new DOMException('x', 'NotAllowedError'), 'denied'],
    [new Error('boom'), 'unknown'],
  ] as const)('shows friendly help when opening fails with %s', async (failure, kind) => {
    const hook = setup(() => Promise.reject(failure));
    act(() => hook.result.current.start());
    await elapse(0);
    expect(hook.result.current.state).toEqual({ status: 'error', kind });
    expect(hook.result.current.outcome).toBe('problem');
    expect(hook.result.current.active).toBe(false);
    expect(hook.announce).toHaveBeenLastCalledWith(MIC_ERROR_HELP[kind]);
  });

  it('falls back to the default device when the saved one has been unplugged', async () => {
    const mic = createFakeMic();
    const open = vi
      .fn<OpenMic>()
      .mockRejectedValueOnce(new MicError('no-device', 'gone'))
      .mockResolvedValueOnce(mic.session);
    const hook = setup(open, mic);
    hook.rerender({ deviceId: 'usb-mic' });
    act(() => hook.result.current.start());
    await elapse(0);
    expect(open.mock.calls).toEqual([['usb-mic'], ['default']]);
    expect(hook.result.current.state).toEqual({ status: 'listening' });
  });

  it('closes the previous microphone when the test is started again', async () => {
    const first = createFakeMic();
    const second = createFakeMic();
    const queue = [first.session, second.session];
    const hook = setup(() => Promise.resolve(queue.shift() ?? second.session));
    await startListening(hook);
    await startListening(hook);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({ status: 'listening' });
  });

  it('turns a failing level read into an error and releases the microphone', async () => {
    const mic = createFakeMic();
    mic.session.readLevel = () => {
      throw new Error('context closed');
    };
    const hook = setup(undefined, mic);
    await startListening(hook);
    await elapse(50);
    expect(hook.result.current.state).toEqual({ status: 'error', kind: 'unknown' });
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.active).toBe(false);
  });

  it('releases the microphone when the component unmounts', async () => {
    const hook = setup();
    await startListening(hook);
    hook.unmount();
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
  });

  it('releases the microphone when the window is hidden', async () => {
    const hook = setup();
    await startListening(hook);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toEqual({ status: 'idle' });
    expect(hook.result.current.active).toBe(false);
  });

  it.each(['pagehide', 'beforeunload'])('releases the microphone on %s', async (type) => {
    const hook = setup();
    await startListening(hook);
    await act(async () => {
      window.dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.mic.stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.active).toBe(false);
  });

  it('keeps reporting the first successful test even if a retry fails afterwards', async () => {
    const mic = createFakeMic();
    mic.level.value = 0.3;
    const open = vi
      .fn<OpenMic>()
      .mockResolvedValueOnce(mic.session)
      .mockRejectedValueOnce(new MicError('busy', 'in use'));
    const hook = setup(open, mic);
    await startListening(hook);
    await elapse(600);
    expect(hook.result.current.outcome).toBe('heard');
    await startListening(hook);
    expect(hook.result.current.state).toEqual({ status: 'error', kind: 'busy' });
    expect(hook.result.current.outcome).toBe('heard');
  });
});

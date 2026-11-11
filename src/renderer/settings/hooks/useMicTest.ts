import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  MIC_ERROR_HELP,
  MicError,
  openMic,
  toMicError,
  type MicErrorKind,
  type MicSession,
} from '@renderer/lib/voice/mic';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';

export type MicTestState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'listening'; secondsLeft: number }
  | { status: 'done'; heard: boolean }
  | { status: 'error'; kind: MicErrorKind; message: string };

const MIC_TEST_MS = 5000;
/** The frame loop pauses in hidden windows, so a plain timer is the hard stop. */
const HARD_STOP_MS = MIC_TEST_MS + 750;
/** Speech sits around 0.02-0.2 RMS; the meter scales it up like the assistant bar does. */
const LEVEL_GAIN = 6;
const HEARD_LEVEL = 0.12;

export interface MicTest {
  state: MicTestState;
  /** Instantaneous level 0..1 for the LevelMeter (which smooths it). */
  levelRef: MutableRefObject<number>;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Opens the chosen microphone for about five seconds and reports its level. The microphone is
 * released when the test ends, the user stops it, the device changes, the section unmounts or the
 * window is hidden or closed: it never stays on.
 */
export function useMicTest(deviceId: string): MicTest {
  const [state, setState] = useState<MicTestState>({ status: 'idle' });
  const levelRef = useRef(0);
  const session = useRef<MicSession | null>(null);
  const peak = useRef(0);
  const deadline = useRef(0);
  const shownSeconds = useRef(0);
  const hardStop = useRef<number | null>(null);
  /** Bumped on every release so a slow `openMic` that resolves late closes itself. */
  const generation = useRef(0);

  const release = useCallback((): void => {
    generation.current += 1;
    if (hardStop.current !== null) window.clearTimeout(hardStop.current);
    hardStop.current = null;
    session.current?.stop();
    session.current = null;
    levelRef.current = 0;
  }, []);

  const stop = useCallback((): void => {
    release();
    setState({ status: 'idle' });
  }, [release]);

  const finish = useCallback((): void => {
    const heard = peak.current >= HEARD_LEVEL;
    release();
    setState({ status: 'done', heard });
  }, [release]);

  const start = useCallback(async (): Promise<void> => {
    release();
    const mine = generation.current;
    peak.current = 0;
    setState({ status: 'starting' });
    try {
      const mic = await openMic(deviceId);
      if (generation.current !== mine) {
        mic.stop();
        return;
      }
      if (document.visibilityState === 'hidden') {
        mic.stop();
        setState({ status: 'idle' });
        return;
      }
      session.current = mic;
      deadline.current = performance.now() + MIC_TEST_MS;
      shownSeconds.current = Math.ceil(MIC_TEST_MS / 1000);
      hardStop.current = window.setTimeout(finish, HARD_STOP_MS);
      setState({ status: 'listening', secondsLeft: shownSeconds.current });
    } catch (error) {
      if (generation.current !== mine) return;
      const failure = error instanceof MicError ? error : toMicError(error);
      setState({ status: 'error', kind: failure.kind, message: MIC_ERROR_HELP[failure.kind] });
    }
  }, [deviceId, release, finish]);

  useAnimationLoop(() => {
    const mic = session.current;
    if (!mic) return;
    const level = Math.min(1, mic.readLevel() * LEVEL_GAIN);
    levelRef.current = level;
    peak.current = Math.max(peak.current, level);
    const remaining = deadline.current - performance.now();
    if (remaining <= 0) {
      finish();
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    if (seconds !== shownSeconds.current) {
      shownSeconds.current = seconds;
      setState({ status: 'listening', secondsLeft: seconds });
    }
  }, state.status === 'listening');

  const previousDevice = useRef(deviceId);
  useEffect(() => {
    if (previousDevice.current === deviceId) return;
    previousDevice.current = deviceId;
    stop();
  }, [deviceId, stop]);

  useEffect(() => {
    const onHide = (): void => {
      if (session.current) stop();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [release, stop]);

  return { state, levelRef, start, stop };
}

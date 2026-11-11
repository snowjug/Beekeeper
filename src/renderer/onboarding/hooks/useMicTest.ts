import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { MIC_ERROR_HELP, type MicSession } from '@renderer/lib/voice/mic';
import { smoothTowards } from '@renderer/motion/math';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';
import { asMicError, openWithFallback, type OpenMic } from '../micOpen';
import { SILENT_TEXT } from '../micCopy';
import { micOutcomeOf, type MicOutcome } from '../summary';
import type { MicTestState } from '../types';
import {
  MIC_SUCCESS_RELEASE_MS,
  MIC_TEST_TIMEOUT_MS,
  toMeterLevel,
  VoiceDetector,
} from '../voiceDetector';

export interface MicTest {
  state: MicTestState;
  /** True while the microphone is open (the screen shows an "on" indicator meanwhile). */
  active: boolean;
  outcome: MicOutcome;
  /** Smoothed 0..1 meter level, read every frame without re-rendering. */
  levelRef: MutableRefObject<number>;
  start: () => void;
  /** Releases the microphone at once; a finished result (heard / error) stays visible. */
  stop: () => void;
}

export interface MicTestOptions {
  openMic: OpenMic;
  deviceId: string;
  announce: (text: string) => void;
}

/**
 * The microphone test: opens the saved device, shows a live level and decides whether sound was
 * heard. The microphone is released on success (after a second), after 8 s of silence, when the
 * test is stopped, when the page is hidden or unloaded and when the component unmounts.
 */
export function useMicTest({ openMic, deviceId, announce }: MicTestOptions): MicTest {
  const [state, setState] = useState<MicTestState>({ status: 'idle' });
  const [active, setActive] = useState(false);
  const [heard, setHeard] = useState(false);
  const levelRef = useRef(0);
  const session = useRef<MicSession | null>(null);
  const detector = useRef<VoiceDetector | null>(null);
  const generation = useRef(0);
  const timers = useRef<{ timeout?: number; release?: number }>({});

  const release = useCallback(() => {
    generation.current += 1;
    window.clearTimeout(timers.current.timeout);
    window.clearTimeout(timers.current.release);
    timers.current = {};
    session.current?.stop();
    session.current = null;
    levelRef.current = 0;
    setActive(false);
  }, []);

  const stop = useCallback(() => {
    release();
    setState((current) =>
      current.status === 'requesting' || current.status === 'listening'
        ? { status: 'idle' }
        : current,
    );
  }, [release]);

  const fail = useCallback(
    (error: unknown) => {
      release();
      const { kind } = asMicError(error);
      setState({ status: 'error', kind });
      announce(MIC_ERROR_HELP[kind]);
    },
    [release, announce],
  );

  const start = useCallback(() => {
    release();
    const mine = generation.current;
    detector.current = new VoiceDetector();
    setState({ status: 'requesting' });
    void openWithFallback(openMic, deviceId).then(
      (opened) => {
        if (generation.current !== mine) {
          opened.stop();
          return;
        }
        session.current = opened;
        setActive(true);
        setState({ status: 'listening' });
        announce('Listening. Say something.');
        timers.current.timeout = window.setTimeout(() => {
          if (generation.current !== mine) return;
          release();
          setState({ status: 'silent' });
          announce(SILENT_TEXT);
        }, MIC_TEST_TIMEOUT_MS);
      },
      (error: unknown) => {
        if (generation.current === mine) fail(error);
      },
    );
  }, [release, fail, openMic, deviceId, announce]);

  useAnimationLoop((dt) => {
    const current = session.current;
    const sensor = detector.current;
    if (!current || !sensor) return;
    let rms: number;
    try {
      rms = current.readLevel();
    } catch (error) {
      fail(error);
      return;
    }
    levelRef.current = smoothTowards(levelRef.current, toMeterLevel(rms), dt, 0.04, 0.2);
    const wasDetected = sensor.detected;
    if (sensor.push(rms, dt * 1000) && !wasDetected) {
      window.clearTimeout(timers.current.timeout);
      setHeard(true);
      setState({ status: 'heard' });
      announce('I can hear you.');
      timers.current.release = window.setTimeout(release, MIC_SUCCESS_RELEASE_MS);
    }
  }, active);

  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') stop();
    };
    window.addEventListener('pagehide', release);
    window.addEventListener('beforeunload', release);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', release);
      window.removeEventListener('beforeunload', release);
      document.removeEventListener('visibilitychange', onHidden);
      release();
    };
  }, [release, stop]);

  const outcome = micOutcomeOf(heard, state);
  return { state, active, outcome, levelRef, start, stop };
}

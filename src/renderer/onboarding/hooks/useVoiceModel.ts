import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceModelState } from '@shared/ipc/types';
import { logFailure, type OnboardingBridge } from '../bridge';
import { settleModelState } from '../modelFormat';
import { useLatest } from './useLatest';

const STATUS_ERROR = 'Couldn’t check the voice model right now.';
const START_ERROR = 'Couldn’t start the download. Please try again.';
const PAUSE_ERROR = 'Couldn’t pause the download.';

export interface VoiceModelController {
  /** Null until the first status arrives. */
  state: VoiceModelState | null;
  /** Friendly text when talking to the main process failed. */
  error: string | null;
  /** True after the user paused, so the screen can say "Paused" rather than "Not finished". */
  paused: boolean;
  /** Starts, resumes or retries the download (never called without a click). */
  start: () => void;
  /** Stops the transfer; the partial file is kept. */
  pause: () => void;
}

/** What the UI shows between clicking "Download" and the first progress event. */
function startingState(current: VoiceModelState): VoiceModelState {
  const { message: _message, ...rest } = current;
  return { ...rest, state: 'downloading', bytesPerSecond: 0, etaSeconds: null, attempt: 1 };
}

/**
 * Keeps the voice-model status (`voice:modelStatus` once, then `voice:modelProgress` events) and the
 * two things a user can do with it. Events are newer than any invoke reply, so a reply is only
 * applied when no event arrived while it was in flight.
 */
export function useVoiceModel(bridge: OnboardingBridge): VoiceModelController {
  const [state, setState] = useState<VoiceModelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const latest = useLatest(state);
  const pausedRef = useRef(false);
  const events = useRef(0);
  const mounted = useRef(true);

  const apply = useCallback((next: VoiceModelState) => {
    setState(settleModelState(next, pausedRef.current));
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const seen = events.current;
    const off = bridge.on('voice:modelProgress', (next) => {
      events.current += 1;
      if (alive) apply(next);
    });
    bridge
      .invoke('voice:modelStatus')
      .then((next) => {
        if (alive && events.current === seen) apply(next);
      })
      .catch((failure: unknown) => {
        logFailure(bridge, 'voice:modelStatus', failure);
        if (alive) setError(STATUS_ERROR);
      });
    return () => {
      alive = false;
      off();
    };
  }, [bridge, apply]);

  const start = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    setError(null);
    const seen = events.current;
    const before = latest.current;
    if (before && before.state !== 'ready') setState(startingState(before));
    bridge
      .invoke('voice:modelEnsure')
      .then((next) => {
        // A stale "error" (from the previous attempt) must not undo the click; events follow.
        if (mounted.current && events.current === seen && next.state !== 'error') apply(next);
      })
      .catch((failure: unknown) => {
        logFailure(bridge, 'voice:modelEnsure', failure);
        if (!mounted.current) return;
        setError(START_ERROR);
        if (events.current === seen) setState(before);
      });
  }, [bridge, apply, latest]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    const seen = events.current;
    bridge
      .invoke('voice:modelCancel')
      .then((next) => {
        if (mounted.current && events.current === seen) apply(next);
      })
      .catch((failure: unknown) => {
        logFailure(bridge, 'voice:modelCancel', failure);
        if (mounted.current) setError(PAUSE_ERROR);
      });
  }, [bridge, apply]);

  return { state, error, paused, start, pause };
}

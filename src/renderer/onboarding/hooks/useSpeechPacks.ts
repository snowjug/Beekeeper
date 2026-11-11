import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechState } from '@shared/ipc/types';
import type { SpeechPackId } from '@shared/speech/packs';
import { logFailure, type OnboardingBridge } from '../bridge';
import { packsInMotion, packsToStart } from '../packFormat';
import { useLatest } from './useLatest';

const STATUS_ERROR = 'Couldn’t check the downloads right now.';
const START_ERROR = 'Couldn’t start the download. Please try again.';
const PAUSE_ERROR = 'Couldn’t pause the download.';

export interface SpeechPacksController {
  /** Null until the first status arrives. */
  state: SpeechState | null;
  /** Friendly text when talking to the main process failed. */
  error: string | null;
  /** True after the user paused, so the screen can say "Paused" rather than "Not finished". */
  paused: boolean;
  /** True from "Download" until the user pauses or something fails. */
  started: boolean;
  /** Starts, resumes or retries the downloads (never called without a click). */
  start: () => void;
  /** Stops what is moving; the files already downloaded are kept. */
  pause: () => void;
}

/** What the UI shows between clicking "Download" and the first progress event. */
function startingState(current: SpeechState, ids: readonly SpeechPackId[]): SpeechState {
  const packs = { ...current.packs };
  for (const id of ids) {
    const { message: _message, ...rest } = packs[id];
    packs[id] = { ...rest, state: 'downloading', bytesPerSecond: 0, etaSeconds: null };
  }
  return { ...current, packs };
}

/**
 * Keeps the on-device speech packs (`speech:status` once, then `speech:state` events) and the two
 * things a user can do with a set of them. Events are newer than any invoke reply, so a reply is
 * only applied when no event arrived while it was in flight.
 */
export function useSpeechPacks(
  bridge: OnboardingBridge,
  wanted: readonly SpeechPackId[],
): SpeechPacksController {
  const [state, setState] = useState<SpeechState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const latest = useLatest(state);
  const events = useRef(0);
  const mounted = useRef(true);
  const ids = useRef(wanted);

  useEffect(() => {
    ids.current = wanted;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const seen = events.current;
    const off = bridge.on('speech:state', (next) => {
      events.current += 1;
      if (alive) setState(next);
    });
    bridge
      .invoke('speech:status')
      .then((next) => {
        if (alive && events.current === seen) setState(next);
      })
      .catch((failure: unknown) => {
        logFailure(bridge, 'speech:status', failure);
        if (alive) setError(STATUS_ERROR);
      });
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const start = useCallback(() => {
    setPaused(false);
    setStarted(true);
    setError(null);
    const seen = events.current;
    const before = latest.current;
    const toStart = packsToStart(before, ids.current);
    if (before) setState(startingState(before, toStart));
    for (const pack of toStart) {
      bridge
        .invoke('speech:ensurePack', { pack })
        .then((next) => {
          // A stale "error" (from the previous attempt) must not undo the click; events follow.
          if (mounted.current && events.current === seen && next.packs[pack].state !== 'error') {
            setState(next);
          }
        })
        .catch((failure: unknown) => {
          logFailure(bridge, 'speech:ensurePack', failure);
          if (!mounted.current) return;
          setError(START_ERROR);
          setStarted(false);
          if (events.current === seen) setState(before);
        });
    }
  }, [bridge, latest]);

  const pause = useCallback(() => {
    setPaused(true);
    setStarted(false);
    const seen = events.current;
    for (const pack of packsInMotion(latest.current, ids.current)) {
      bridge
        .invoke('speech:cancelPack', { pack })
        .then((next) => {
          if (mounted.current && events.current === seen) setState(next);
        })
        .catch((failure: unknown) => {
          logFailure(bridge, 'speech:cancelPack', failure);
          if (mounted.current) setError(PAUSE_ERROR);
        });
    }
  }, [bridge, latest]);

  return { state, error, paused, started, start, pause };
}

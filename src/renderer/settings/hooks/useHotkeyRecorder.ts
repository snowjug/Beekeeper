import { useCallback, useEffect, useRef, useState } from 'react';
import { captureAccelerator } from '@shared/hotkeys';
import type { HotkeySetResult } from '@shared/ipc/types';
import {
  IDLE_RECORDER,
  isCancelKey,
  reduceRecorder,
  type RecorderAction,
  type RecorderState,
} from '../lib/hotkeyRecorder';

export interface HotkeyRecorder {
  state: RecorderState;
  /** Starts listening for a new shortcut. */
  start: () => void;
  /** Leaves recording or dismisses a failure message. */
  cancel: () => void;
  /** Sends a known accelerator right away ("Use <suggestion>", "Reset to default"). */
  choose: (accelerator: string) => void;
}

const FAILED_TO_SEND: HotkeySetResult = {
  ok: false,
  reason: 'invalid',
  message: 'Beekeeper could not change that shortcut. Please try again.',
};

/** Key releases (and auto-repeats) of the combination just pressed must not leak into the page. */
const RELEASE_GRACE_MS = 600;

function swallow(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Drives the "Change shortcut" flow. While recording (and while the choice is being registered)
 * every key event is swallowed at the window so nothing else reacts to the keystrokes. Esc or
 * losing focus cancels; a valid combination is sent to `submit` as soon as it is pressed.
 */
export function useHotkeyRecorder(
  submit: (accelerator: string) => Promise<HotkeySetResult>,
): HotkeyRecorder {
  const [state, setState] = useState<RecorderState>(IDLE_RECORDER);
  const current = useRef<RecorderState>(IDLE_RECORDER);
  const alive = useRef(true);
  const submitRef = useRef(submit);

  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((action: RecorderAction): RecorderState => {
    const next = reduceRecorder(current.current, action);
    current.current = next;
    if (alive.current) setState(next);
    return next;
  }, []);

  const send = useCallback(
    async (accelerator: string): Promise<void> => {
      let result: HotkeySetResult;
      try {
        result = await submitRef.current(accelerator);
      } catch {
        result = FAILED_TO_SEND;
      }
      apply({ type: 'result', attempted: accelerator, result });
    },
    [apply],
  );

  const choose = useCallback(
    (accelerator: string): void => {
      const next = apply({ type: 'submit', accelerator });
      if (next.phase === 'saving') void send(next.accelerator);
    },
    [apply, send],
  );

  const start = useCallback((): void => {
    apply({ type: 'start' });
  }, [apply]);

  const cancel = useCallback((): void => {
    apply({ type: 'cancel' });
  }, [apply]);

  const capturing = state.phase === 'recording' || state.phase === 'saving';
  useEffect(() => {
    if (!capturing) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      swallow(event);
      if (event.repeat || current.current.phase !== 'recording') return;
      if (isCancelKey(event)) {
        apply({ type: 'cancel' });
        return;
      }
      const next = apply({ type: 'keys', keys: captureAccelerator(event) });
      if (next.phase === 'saving') void send(next.accelerator);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      swallow(event);
      if (current.current.phase !== 'recording') return;
      apply({ type: 'keys', keys: { modifiers: captureAccelerator(event).modifiers, key: null } });
    };
    const onBlur = (): void => {
      apply({ type: 'cancel' });
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      window.addEventListener('keydown', swallow, true);
      window.addEventListener('keyup', swallow, true);
      window.setTimeout(() => {
        window.removeEventListener('keydown', swallow, true);
        window.removeEventListener('keyup', swallow, true);
      }, RELEASE_GRACE_MS);
    };
  }, [capturing, apply, send]);

  return { state, start, cancel, choose };
}

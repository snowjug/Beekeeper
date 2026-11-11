import { useEffect, useState } from 'react';
import type { HotkeyStatus } from '@shared/ipc/types';
import { logFailure, type OnboardingBridge } from '../bridge';

/**
 * Whether each global hotkey actually got registered (another app may own the combination).
 * Re-read when a binding changes; null until known, in which case the UI shows no status.
 */
export function useHotkeyStatus(
  bridge: OnboardingBridge,
  assistant: string,
  circle: string,
): HotkeyStatus | null {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);

  useEffect(() => {
    let alive = true;
    bridge
      .invoke('hotkeys:status')
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((failure: unknown) => logFailure(bridge, 'hotkeys:status', failure));
    return () => {
      alive = false;
    };
  }, [bridge, assistant, circle]);

  return status;
}

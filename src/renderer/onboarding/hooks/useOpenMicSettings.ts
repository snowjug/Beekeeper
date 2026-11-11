import { useCallback, useState } from 'react';
import { logFailure, type OnboardingBridge } from '../bridge';

/** "Open Windows microphone settings": `failed` becomes true when Windows refused to open it. */
export function useOpenMicSettings(bridge: OnboardingBridge): {
  open: () => void;
  failed: boolean;
} {
  const [failed, setFailed] = useState(false);
  const open = useCallback(() => {
    setFailed(false);
    bridge
      .invoke('os:openMicSettings')
      .then((opened) => {
        if (!opened) setFailed(true);
      })
      .catch((failure: unknown) => {
        logFailure(bridge, 'os:openMicSettings', failure);
        setFailed(true);
      });
  }, [bridge]);
  return { open, failed };
}

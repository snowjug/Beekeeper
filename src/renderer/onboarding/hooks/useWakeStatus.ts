import { useEffect, useState } from 'react';
import type { WorkerStatus } from '@shared/ipc/types';
import type { OnboardingBridge } from '../bridge';

/** Latest report of the wake-word worker (loading / armed / paused / error); null if none yet. */
export function useWakeStatus(bridge: OnboardingBridge): WorkerStatus | null {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  useEffect(() => bridge.on('voice:wakeStatus', (next) => setStatus(next)), [bridge]);
  return status;
}

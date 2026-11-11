import { useCallback, useRef } from 'react';

/**
 * Leading-edge debounce for the footer buttons: the first activation runs, anything within
 * `cooldownMs` is dropped. A double click on "Get started" must neither skip a screen nor press
 * the next screen's primary button.
 */
export function useActionGuard(cooldownMs: number): (action: () => void) => void {
  const lastRun = useRef(Number.NEGATIVE_INFINITY);
  return useCallback(
    (action: () => void) => {
      const now = performance.now();
      if (now - lastRun.current < cooldownMs) return;
      lastRun.current = now;
      action();
    },
    [cooldownMs],
  );
}

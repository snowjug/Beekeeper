import { useEffect, useRef } from 'react';

/**
 * Runs `callback` every animation frame while `running` is true and the page is visible.
 * Hidden windows never burn CPU: the loop pauses on visibilitychange and resumes cleanly.
 */
export function useAnimationLoop(
  callback: (dtSeconds: number, elapsedSeconds: number) => void,
  running: boolean,
): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!running) return undefined;
    let frame = 0;
    let alive = true;
    let last = performance.now();
    const started = last;

    const tick = (now: number): void => {
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      callbackRef.current(dt, (now - started) / 1000);
      frame = requestAnimationFrame(tick);
    };

    const onVisibility = (): void => {
      cancelAnimationFrame(frame);
      if (document.visibilityState === 'visible' && alive) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    if (document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [running]);
}

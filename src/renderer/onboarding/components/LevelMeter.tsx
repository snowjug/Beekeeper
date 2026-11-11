import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { clamp } from '@renderer/motion/math';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';

export interface LevelMeterProps {
  /** Smoothed 0..1 level, written by the microphone test every frame (0 once released). */
  levelRef: MutableRefObject<number>;
  active: boolean;
  /** Position (0..1) of the "counts as sound" tick. */
  threshold: number;
}

const ARIA_STEP = 4;

/**
 * Bar meter driven straight from a ref (no React re-render per frame). It keeps working with
 * reduced motion because it is an instrument, not decoration. `aria-valuenow` only changes in
 * 4 % steps so assistive technology is not flooded.
 */
export function LevelMeter({ levelRef, active, threshold }: LevelMeterProps) {
  const meter = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const spoken = useRef(0);

  const paint = useCallback((): void => {
    const level = clamp(levelRef.current, 0, 1);
    if (fill.current) fill.current.style.transform = `scaleX(${level.toFixed(3)})`;
    const percent = Math.round(level * 100);
    if (meter.current && Math.abs(percent - spoken.current) >= ARIA_STEP) {
      spoken.current = percent;
      meter.current.setAttribute('aria-valuenow', String(percent));
    }
  }, [levelRef]);

  useAnimationLoop(paint, active);

  // When the microphone is released, settle the bar at zero.
  useEffect(() => {
    if (!active) paint();
  }, [active, paint]);

  return (
    <div
      ref={meter}
      role="meter"
      aria-label="Input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      className="relative h-2.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div
        ref={fill}
        className="bk-brand-gradient absolute inset-0 origin-left rounded-full"
        style={{
          transform: 'scaleX(0)',
          transition: active ? 'none' : 'transform 320ms var(--bk-ease)',
        }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 w-0.5 bg-fg/45"
        style={{ left: `${clamp(threshold, 0, 1) * 100}%` }}
      />
    </div>
  );
}

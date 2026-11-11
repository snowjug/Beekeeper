import { forwardRef, type ReactNode } from 'react';

export interface ProgressRingProps {
  /** 0..1 filled fraction (ignored when the parent animates the stroke through `ringRef`). */
  value?: number;
  size?: number;
  stroke?: number;
  /** CSS colour of the progress arc. */
  color?: string;
  /** Content centred inside the ring. */
  children?: ReactNode;
  className?: string;
  label?: string;
}

/**
 * SVG progress ring. The arc is an SVG circle whose stroke-dashoffset can either follow
 * `value` (with a smooth CSS transition) or be driven imperatively via `ringRef`
 * (used by timers for a perfectly smooth 60 fps countdown).
 */
export const ProgressRing = forwardRef<SVGCircleElement, ProgressRingProps>(function ProgressRing(
  { value = 0, size = 72, stroke = 6, color = 'var(--bk-honey)', children, className = '', label },
  ringRef,
) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--bk-border)"
          strokeWidth={stroke}
        />
        <circle
          ref={ringRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 300ms var(--bk-ease)' }}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      ) : null}
    </div>
  );
});

/** Circumference helper so animators can compute stroke-dashoffset without re-deriving it. */
export function ringCircumference(size: number, stroke: number): number {
  return 2 * Math.PI * ((size - stroke) / 2);
}

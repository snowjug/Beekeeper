import { clamp01 } from '../lib/format';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label: string;
}

/** Thin determinate bar; only transform animates (compositor friendly). */
export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = clamp01(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div
        className="h-full origin-left rounded-full bg-accent"
        style={{
          transform: `scaleX(${clamped})`,
          transition: 'transform 300ms var(--bk-ease)',
        }}
      />
    </div>
  );
}

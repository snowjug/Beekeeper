import { BRAND_COLORS } from '@shared/constants';
import { StepIndicator } from './StepIndicator';

const DOTS = [BRAND_COLORS.honey, BRAND_COLORS.coral, BRAND_COLORS.violet, BRAND_COLORS.cyan];

export interface TitleBarProps {
  stepIndex: number;
  /** The "Skip tour" link; hidden on the last screen where the primary button already finishes. */
  canSkip: boolean;
  onSkip: () => void;
}

/**
 * The 40 px strip behind the native caption buttons. It drags the window and holds, left of the
 * caption buttons, the brand mark and the always-available "Skip tour" link; the five-step progress
 * is centred on the window. Everything interactive opts out of dragging.
 */
export function TitleBar({ stepIndex, canSkip, onSkip }: TitleBarProps) {
  return (
    <>
      <header className="ob-titlebar ob-drag z-30 flex items-center justify-between px-4 select-none">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-fg-muted">
          <span aria-hidden className="flex items-center gap-[3px]">
            {DOTS.map((color) => (
              <span
                key={color}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: color }}
              />
            ))}
          </span>
          Beekeeper
        </div>
        {canSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="ob-no-drag rounded-control px-2.5 py-1 text-[13px] font-medium text-fg-muted underline-offset-4 transition-colors duration-[var(--bk-dur-fast)] hover:text-fg hover:underline"
          >
            Skip tour
          </button>
        ) : null}
      </header>
      <div className="ob-drag fixed top-0 left-1/2 z-30 flex h-10 -translate-x-1/2 items-center">
        <StepIndicator index={stepIndex} />
      </div>
    </>
  );
}

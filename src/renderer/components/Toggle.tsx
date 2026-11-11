import { motion } from 'framer-motion';
import { spring } from '@renderer/motion/tokens';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name for the switch. */
  label: string;
  disabled?: boolean;
  id?: string;
}

const TRACK_WIDTH = 44;
const KNOB = 20;
const PADDING = 2;

/** Accessible switch with a spring-loaded knob. */
export function Toggle({ checked, onChange, label, disabled = false, id }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 shrink-0 cursor-pointer items-center rounded-full border border-line transition-colors duration-[var(--bk-dur-base)] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-transparent bg-accent' : 'bg-sunken'
      }`}
      style={{ width: TRACK_WIDTH }}
    >
      <motion.span
        aria-hidden
        className="absolute rounded-full bg-white shadow-soft"
        style={{ width: KNOB, height: KNOB, left: PADDING }}
        initial={false}
        animate={{ x: checked ? TRACK_WIDTH - KNOB - PADDING * 2 - 2 : 0 }}
        transition={spring.bouncy}
        whileTap={{ scaleX: 1.12 }}
      />
    </button>
  );
}

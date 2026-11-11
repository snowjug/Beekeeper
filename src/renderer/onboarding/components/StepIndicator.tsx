import { motion } from 'framer-motion';
import { spring } from '@renderer/motion/tokens';
import { STEP_COUNT, STEPS, stepAt, stepProgressLabel } from '../navigation';

/** Five pills that fill up as the user moves through the tour (scaleX springs: transform only). */
export function StepIndicator({ index }: { index: number }) {
  const label = stepProgressLabel(index);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={STEP_COUNT}
      aria-valuenow={index + 1}
      aria-valuetext={`${label}: ${stepAt(index).title}`}
      className="flex items-center gap-2"
    >
      {STEPS.map((step, position) => (
        <span
          key={step.id}
          aria-hidden
          className="relative h-1.5 w-9 overflow-hidden rounded-full bg-line"
        >
          <motion.span
            className={`absolute inset-0 origin-left rounded-full ${
              position === index ? 'bk-brand-gradient' : 'bg-accent'
            }`}
            initial={false}
            animate={{ scaleX: position <= index ? 1 : 0, opacity: position === index ? 1 : 0.9 }}
            transition={spring.soft}
          />
        </span>
      ))}
    </div>
  );
}

import { motion } from 'framer-motion';
import { Fragment, type CSSProperties } from 'react';
import { spring } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { describeShortcut, keyCapsFor } from '../keycaps';

export interface KeyCapsProps {
  accelerator: string;
  /** Seconds before the first cap pops in. */
  delay?: number;
}

/**
 * A shortcut drawn as physical key caps that spring in one after another and then "press" now and
 * again. The group is announced as one image ("Ctrl + Shift + Space"), not as separate keys.
 */
export function KeyCaps({ accelerator, delay = 0 }: KeyCapsProps) {
  const reduceMotion = useReduceMotion();
  const keys = keyCapsFor(accelerator);
  return (
    <span
      role="img"
      aria-label={describeShortcut(accelerator)}
      className="inline-flex flex-wrap items-center gap-1.5"
    >
      {keys.map((key, position) => (
        <Fragment key={`${position}-${key}`}>
          {position > 0 ? (
            <span aria-hidden className="text-[13px] font-medium text-fg-faint">
              +
            </span>
          ) : null}
          <motion.span
            aria-hidden
            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring.bouncy, delay: delay + position * 0.09 }}
          >
            <kbd
              className={`inline-flex h-10 min-w-11 items-center justify-center rounded-[10px] border border-b-[3px] border-line bg-raised px-3 text-[14px] font-semibold text-fg shadow-soft ${
                reduceMotion ? '' : 'ob-press'
              }`}
              style={{ '--ob-delay': `${delay + 1.6 + position * 0.16}s` } as CSSProperties}
            >
              {key}
            </kbd>
          </motion.span>
        </Fragment>
      ))}
    </span>
  );
}

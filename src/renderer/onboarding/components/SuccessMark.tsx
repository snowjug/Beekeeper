import { motion } from 'framer-motion';
import { spring, tween } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';

export interface SuccessMarkProps {
  size?: number;
}

/** Green check that pops in and draws itself (static with reduced motion). */
export function SuccessMark({ size = 44 }: SuccessMarkProps) {
  const reduceMotion = useReduceMotion();
  const drawn = (delay: number) => ({
    initial: reduceMotion ? false : { pathLength: 0 },
    animate: { pathLength: 1 },
    transition: { ...tween.slow, delay },
  });
  return (
    <motion.svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      focusable="false"
      initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring.bouncy}
    >
      <circle
        cx="24"
        cy="24"
        r="21"
        stroke="var(--bk-success)"
        strokeOpacity="0.28"
        strokeWidth="3"
      />
      <motion.circle
        cx="24"
        cy="24"
        r="21"
        stroke="var(--bk-success)"
        strokeWidth="3"
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
        {...drawn(0)}
      />
      <motion.path
        d="m14.5 25 6.5 6.5 12.5-14"
        stroke="var(--bk-success)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...drawn(0.28)}
      />
    </motion.svg>
  );
}

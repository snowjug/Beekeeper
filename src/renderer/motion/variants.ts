import type { Variants } from 'framer-motion';
import { spring, tween } from './tokens';

/** Assistant bar: slide up + scale 0.96 -> 1 + fade; reverse on exit. */
export const barVariants: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.96, transition: tween.fast },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.soft },
  exit: { opacity: 0, y: 20, scale: 0.97, transition: tween.fast },
};

/** Cards: staggered spring entrance (custom = index). */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring.soft, delay: Math.min(index, 8) * 0.05 },
  }),
  exit: { opacity: 0, y: -8, scale: 0.98, transition: tween.fast },
};

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tween.base },
  exit: { opacity: 0, transition: tween.fast },
};

export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: spring.snappy },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: tween.fast },
};

/** Staggers children (chips, list items). */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: spring.soft },
};

/** Words of the live transcript fade in and de-blur, staggered 25 ms. */
export const WORD_STAGGER_SECONDS = 0.025;

export const wordVariants: Variants = {
  hidden: { opacity: 0, filter: 'blur(6px)' },
  visible: (index: number = 0) => ({
    opacity: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.22,
      ease: [0.2, 0, 0, 1],
      delay: Math.min(index, 24) * WORD_STAGGER_SECONDS,
    },
  }),
};

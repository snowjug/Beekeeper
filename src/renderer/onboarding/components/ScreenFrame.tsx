import { motion, type Variants } from 'framer-motion';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { spring, tween } from '@renderer/motion/tokens';
import { staggerContainer, staggerItem } from '@renderer/motion/variants';
import type { Direction } from '../navigation';

const SLIDE_DISTANCE = 56;

/** Direction-aware: forward slides in from the right and out to the left, backward the reverse. */
const slideVariants: Variants = {
  enter: (direction: Direction = 1) => ({ opacity: 0, x: direction * SLIDE_DISTANCE }),
  center: { opacity: 1, x: 0, transition: spring.soft },
  exit: (direction: Direction = 1) => ({
    opacity: 0,
    x: direction * -SLIDE_DISTANCE,
    transition: tween.fast,
  }),
};

/** Reduced motion: plain fades, nothing travels. */
const fadeVariants: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: tween.base },
  exit: { opacity: 0, transition: tween.fast },
};

export interface ScreenFrameProps {
  direction: Direction;
  /** Heading content; wrap emphasis words in `<span className="bk-brand-text">`. */
  title: ReactNode;
  description?: ReactNode;
  /** Visual above the heading (orb...). */
  hero?: ReactNode;
  children?: ReactNode;
  /** Width of the content column. */
  width?: 'narrow' | 'wide';
  className?: string;
}

/**
 * Shared layout of every onboarding screen: the keyed child of `AnimatePresence` (slide + fade),
 * a staggered content column and the heading that receives focus when the screen appears.
 */
export function ScreenFrame({
  direction,
  title,
  description,
  hero,
  children,
  width = 'narrow',
  className = '',
}: ScreenFrameProps) {
  const reduceMotion = useReduceMotion();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.section
      variants={reduceMotion ? fadeVariants : slideVariants}
      custom={direction}
      initial="enter"
      animate="center"
      exit="exit"
      aria-labelledby={headingId}
      className="absolute inset-0 flex overflow-y-auto px-12 py-1"
    >
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className={`m-auto flex w-full flex-col items-center text-center ${
          width === 'wide' ? 'max-w-[800px]' : 'max-w-[640px]'
        } ${className}`}
      >
        {hero ? (
          <motion.div variants={staggerItem} className="mb-4">
            {hero}
          </motion.div>
        ) : null}
        <motion.h1
          ref={heading}
          id={headingId}
          tabIndex={-1}
          variants={staggerItem}
          className="font-display text-[38px] leading-[1.1] font-semibold tracking-[-0.02em] text-fg outline-none"
        >
          {title}
        </motion.h1>
        {description ? (
          <motion.p
            variants={staggerItem}
            className="mt-3 max-w-[540px] text-[15px] leading-relaxed text-fg-muted"
          >
            {description}
          </motion.p>
        ) : null}
        {children}
      </motion.div>
    </motion.section>
  );
}

/** One staggered block inside a screen (fades and rises in after the heading). */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

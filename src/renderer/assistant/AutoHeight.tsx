import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { spring } from '@renderer/motion/tokens';

export interface AutoHeightProps {
  children: ReactNode;
  /** CSS max-height; content scrolls beyond it. */
  maxHeight: string;
  className?: string;
  /** When this count grows, the newest `followSelector` element is brought into view. */
  followCount?: number;
  followSelector?: string;
}

const FOLLOW_PADDING = 12;
const FOLLOW_WINDOW_MS = 900;

/**
 * Animates its own height with a spring when the content grows or shrinks, so the bar glides
 * instead of jumping when cards arrive. Content scrolls once it reaches `maxHeight`, and the newest
 * card is scrolled into view (its top edge when it is taller than the viewport).
 */
export function AutoHeight({
  children,
  maxHeight,
  className = '',
  followCount,
  followSelector,
}: AutoHeightProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const previousCount = useRef(followCount);
  const pendingFollow = useRef(false);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    const element = inner.current;
    if (!element) return undefined;
    const measure = (): void => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const followLatest = useCallback(() => {
    const container = scroller.current;
    if (!container || !followSelector) return;
    const items = container.querySelectorAll<HTMLElement>(followSelector);
    const latest = items[items.length - 1];
    if (!latest) return;
    const top = latest.offsetTop;
    const fits = latest.offsetHeight + FOLLOW_PADDING * 2 <= container.clientHeight;
    const target = fits
      ? top + latest.offsetHeight + FOLLOW_PADDING - container.clientHeight
      : top - FOLLOW_PADDING;
    container.scrollTo({
      top: Math.max(0, target),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [followSelector, reduceMotion]);

  useEffect(() => {
    const before = previousCount.current ?? 0;
    previousCount.current = followCount;
    if (followCount === undefined || followCount <= before) return undefined;
    // The spring may still be resizing the container: follow again once it settles.
    pendingFollow.current = true;
    const frame = requestAnimationFrame(followLatest);
    const expire = window.setTimeout(() => {
      pendingFollow.current = false;
    }, FOLLOW_WINDOW_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(expire);
    };
  }, [followCount, followLatest]);

  return (
    <motion.div
      ref={scroller}
      initial={false}
      animate={{ height }}
      transition={spring.soft}
      // The container is the offset parent of the cards, which `followLatest` relies on.
      className={`relative overflow-x-hidden overflow-y-auto ${className}`}
      style={{ maxHeight }}
      onAnimationComplete={() => {
        if (!pendingFollow.current) return;
        pendingFollow.current = false;
        followLatest();
      }}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

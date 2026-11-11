import type { Transition } from 'framer-motion';

/** Spring presets (spec section 5). */
export const spring = {
  snappy: { type: 'spring', stiffness: 500, damping: 32 },
  soft: { type: 'spring', stiffness: 220, damping: 26 },
  bouncy: { type: 'spring', stiffness: 380, damping: 18 },
} as const satisfies Record<string, Transition>;

/** Durations in seconds (Framer Motion) - mirrors --bk-dur-* in tokens.css. */
export const duration = {
  fast: 0.12,
  base: 0.22,
  slow: 0.42,
} as const;

export const durationMs = {
  fast: 120,
  base: 220,
  slow: 420,
} as const;

/** Standard easing cubic-bezier(0.2, 0, 0, 1). */
export const easing = {
  standard: [0.2, 0, 0, 1],
} as const;

export const tween = {
  fast: { duration: duration.fast, ease: easing.standard },
  base: { duration: duration.base, ease: easing.standard },
  slow: { duration: duration.slow, ease: easing.standard },
} as const satisfies Record<string, Transition>;

/** Transition used when the user prefers reduced motion: plain fades, no transforms. */
export const reducedTransition: Transition = { duration: duration.fast, ease: easing.standard };

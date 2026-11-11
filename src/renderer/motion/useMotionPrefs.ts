import { useReducedMotion, type Transition } from 'framer-motion';
import { reducedTransition } from './tokens';

/** Picks `normal` unless the OS asks for reduced motion, in which case a short fade is used. */
export function useMotionTransition(normal: Transition): Transition {
  const reduce = useReducedMotion();
  return reduce ? reducedTransition : normal;
}

/** True when decorative animation (particles, glow, orbiting) must be disabled. */
export function useReduceMotion(): boolean {
  return useReducedMotion() ?? false;
}

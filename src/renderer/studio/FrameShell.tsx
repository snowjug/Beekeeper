import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { spring } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';

/** How far the glow reaches beyond the picture on every side (CSS pixels, see studio.css). */
const GLOW_REACH = 90;

export interface FrameShellProps {
  /** CSS pixels. */
  width: number;
  height: number;
  /** The flowing gradient glow (Settings > Capture Studio); off = a plain border. */
  glow: boolean;
  children: ReactNode;
  /** Drawn over the picture but not clipped to its rounded corners (the crop handles). */
  overlay?: ReactNode;
}

/**
 * The rounded picture with its flowing glow: a soft halo and a crisp ring whose colours drift around the
 * picture like liquid light, and a ribbon of light that flows once around the border while the preview
 * opens. There are no corner marks or hard edges, only curves and colour. With reduced motion the glow
 * stands still and simply appears.
 */
export function FrameShell({ width, height, glow, children, overlay }: FrameShellProps) {
  const reduce = useReduceMotion();
  // The colour layers are squares as big as the glow's diagonal, so they cover it in every rotation.
  const reach = Math.ceil(Math.hypot(width + 2 * GLOW_REACH, height + 2 * GLOW_REACH));
  const style = { width, height, '--bk-reach': `${reach}px` } as CSSProperties;
  return (
    <motion.div
      className="bk-studio-frame relative"
      data-testid="studio-frame"
      data-glow={glow ? 'on' : 'off'}
      data-still={reduce ? 'true' : 'false'}
      style={style}
      initial={reduce ? false : { opacity: 0, scale: 0.94, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={spring.soft}
    >
      {glow ? (
        <>
          <div aria-hidden className="bk-studio-aura">
            <div className="bk-studio-glow">
              <i className="bk-flow bk-flow-warm" />
              <i className="bk-flow bk-flow-cool" />
            </div>
            <div className="bk-studio-ring">
              <i className="bk-flow bk-flow-warm" />
              <i className="bk-flow bk-flow-sheen" />
            </div>
          </div>
          <div aria-hidden className="bk-studio-head" />
        </>
      ) : (
        <div aria-hidden className="bk-studio-plain" />
      )}
      <div className="absolute inset-0 overflow-hidden rounded-[28px] bg-black/30">{children}</div>
      {overlay}
    </motion.div>
  );
}

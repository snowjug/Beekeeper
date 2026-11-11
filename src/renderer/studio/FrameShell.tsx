import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { spring } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';

const CORNERS = [
  { corner: 'tl', x: -22, y: -22 },
  { corner: 'tr', x: 22, y: -22 },
  { corner: 'bl', x: -22, y: 22 },
  { corner: 'br', x: 22, y: 22 },
] as const;

export interface FrameShellProps {
  /** CSS pixels. */
  width: number;
  height: number;
  /** The animated gradient frame and corner brackets (Settings > Capture); off = a plain border. */
  glow: boolean;
  children: ReactNode;
  /** Drawn over the picture but not clipped to its rounded corners (the crop handles). */
  overlay?: ReactNode;
}

/**
 * The rounded picture with its glowing frame: a blurred halo and a crisp 2 px ring that sweep through
 * the brand colours, and four bright L-shaped brackets that snap in when the preview opens. With
 * reduced motion the frame stands still and the brackets simply appear.
 */
export function FrameShell({ width, height, glow, children, overlay }: FrameShellProps) {
  const reduce = useReduceMotion();
  return (
    <motion.div
      className="bk-studio-frame relative"
      data-testid="studio-frame"
      data-glow={glow ? 'on' : 'off'}
      data-still={reduce ? 'true' : 'false'}
      style={{ width, height }}
      initial={reduce ? false : { opacity: 0, scale: 0.93 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.soft}
    >
      {glow ? (
        <>
          <div aria-hidden className="bk-studio-glow" />
          <div aria-hidden className="bk-studio-ring" />
        </>
      ) : (
        <div aria-hidden className="bk-studio-plain" />
      )}
      <div className="absolute inset-0 overflow-hidden rounded-[22px] bg-black/30">{children}</div>
      {overlay}
      {glow
        ? CORNERS.map(({ corner, x, y }, index) => (
            <motion.div
              key={corner}
              aria-hidden
              className="bk-bracket"
              data-corner={corner}
              initial={reduce ? false : { opacity: 0, x, y }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ ...spring.bouncy, delay: reduce ? 0 : 0.12 + index * 0.05 }}
            />
          ))
        : null}
    </motion.div>
  );
}

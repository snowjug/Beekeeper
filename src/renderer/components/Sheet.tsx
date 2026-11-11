import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useDragControls,
  useMotionValue,
} from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { spring, tween } from '@renderer/motion/tokens';
import { IconButton } from './Button';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  header?: ReactNode;
  children: ReactNode;
  /** Initial height as a fraction of the viewport. */
  collapsedRatio?: number;
  /** Expanded height as a fraction of the viewport. */
  expandedRatio?: number;
  className?: string;
}

type Snap = 'collapsed' | 'expanded';

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const update = (): void => setHeight(window.innerHeight);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}

/** Decides where a released drag should settle. Exported for unit tests. */
export function resolveSheetSnap(
  offset: number,
  velocityY: number,
  collapsedOffset: number,
): 'close' | Snap {
  if (velocityY > 650 || offset > collapsedOffset + 90) return 'close';
  if (velocityY < -650 || offset < collapsedOffset / 2) return 'expanded';
  return 'collapsed';
}

/** Bottom sheet: springs up, drag the handle to expand / collapse / dismiss. */
export function Sheet({
  open,
  onClose,
  label,
  header,
  children,
  collapsedRatio = 0.42,
  expandedRatio = 0.9,
  className = '',
}: SheetProps) {
  const viewport = useViewportHeight();
  const [snap, setSnap] = useState<Snap>('collapsed');
  const controls = useAnimationControls();
  const dragControls = useDragControls();
  const y = useMotionValue(0);

  const fullHeight = Math.round(viewport * expandedRatio);
  const collapsedOffset = Math.max(0, fullHeight - Math.round(viewport * collapsedRatio));
  const restingY = snap === 'expanded' ? 0 : collapsedOffset;

  useEffect(() => {
    if (open) void controls.start({ y: restingY, transition: spring.soft });
  }, [open, restingY, controls]);

  useEffect(() => {
    if (!open) setSnap('collapsed');
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="sheet"
          role="dialog"
          aria-modal="false"
          aria-label={label}
          className={`bk-glass fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-[880px] flex-col overflow-hidden rounded-t-[28px] ${className}`}
          style={{ height: fullHeight, y }}
          initial={{ y: fullHeight }}
          animate={controls}
          exit={{ y: fullHeight, transition: tween.base }}
          drag="y"
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: fullHeight }}
          dragElastic={{ top: 0.04, bottom: 0.25 }}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            const decision = resolveSheetSnap(y.get(), info.velocity.y, collapsedOffset);
            if (decision === 'close') {
              onClose();
              return;
            }
            setSnap(decision);
            void controls.start({
              y: decision === 'expanded' ? 0 : collapsedOffset,
              transition: spring.soft,
            });
          }}
        >
          <div
            className="flex cursor-grab touch-none items-center justify-center pt-2.5 pb-1 active:cursor-grabbing"
            onPointerDown={(event) => dragControls.start(event)}
          >
            <div className="h-1.5 w-10 rounded-full bg-fg-faint/60" />
          </div>
          <div className="flex items-center gap-2 px-4 pb-2">
            <div className="min-w-0 flex-1">{header}</div>
            <IconButton
              size="sm"
              icon={snap === 'expanded' ? 'chevron-down' : 'chevron-up'}
              label={snap === 'expanded' ? 'Collapse results' : 'Expand results'}
              aria-expanded={snap === 'expanded'}
              onClick={() => setSnap(snap === 'expanded' ? 'collapsed' : 'expanded')}
            />
            <IconButton size="sm" icon="close" label="Close results" onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

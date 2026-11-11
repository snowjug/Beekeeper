import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { Icon } from '@renderer/components/Icon';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { spring, tween } from '@renderer/motion/tokens';
import { useController } from './context';
import { DrawLayer } from './DrawLayer';
import { defaultKeyboardSelection } from './gestures';
import { ResultsSheet } from './ResultsSheet';
import { SelectionBox } from './SelectionBox';
import { useCircleStore } from './store';

const HINT_VISIBLE_MS = 5200;

function HintPill() {
  const controller = useController();
  const visible = useCircleStore((state) => state.hintVisible);
  const phase = useCircleStore((state) => state.phase);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => {
      controller.hideHint();
    }, HINT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [controller, visible]);

  return (
    <AnimatePresence>
      {visible && phase === 'idle' ? (
        <motion.div
          key="hint"
          role="note"
          className="bk-glass pointer-events-none absolute top-8 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full px-5 py-2.5 text-[15px] font-medium"
          initial={{ opacity: 0, y: -16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring.soft, delay: 0.25 } }}
          exit={{ opacity: 0, y: -8, transition: tween.base }}
        >
          <span className="text-accent-text">
            <Icon name="circle" size={20} />
          </span>
          <span>Circle, scribble or tap anything</span>
          <span className="hidden text-[13px] font-normal text-fg-muted sm:inline">
            Shift + drag for a rectangle &middot; Esc to cancel
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function TapPulse() {
  const point = useCircleStore((state) => state.tapPoint);
  if (!point) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: point.x - 28, top: point.y - 28, width: 56, height: 56 }}
    >
      <div className="bk-tap-pulse absolute inset-0 rounded-full border-2 border-honey" />
      <div className="absolute inset-[18px] rounded-full bg-honey/80 shadow-[0_0_18px_6px_rgba(255,179,0,0.55)]" />
    </div>
  );
}

/** The frozen screen, the dimming, the shimmering border and everything the user interacts with. */
export function App() {
  const controller = useController();
  const reduceMotion = useReduceMotion();
  const session = useCircleStore((state) => state.session);
  const visible = useCircleStore((state) => state.visible);
  const phase = useCircleStore((state) => state.phase);
  const selection = useCircleStore((state) => state.selection);
  const sceneOffset = useCircleStore((state) => state.sceneOffset);

  // Esc cancels everything; Enter/Space start a keyboard selection for people who cannot draw.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useCircleStore.getState();
      if (!state.visible) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        controller.beginExit();
      } else if (
        (event.key === 'Enter' || event.key === ' ') &&
        !state.selection &&
        state.phase === 'idle' &&
        event.target === document.body
      ) {
        event.preventDefault();
        controller.selectRegion(
          defaultKeyboardSelection({ width: window.innerWidth, height: window.innerHeight }),
          'keyboard',
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);

  const sceneTransition = phase === 'drawing' || reduceMotion ? { duration: 0 } : spring.soft;

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      data-testid="circle-overlay"
      data-phase={phase}
      onContextMenu={(event) => {
        event.preventDefault();
        controller.beginExit();
      }}
    >
      <AnimatePresence onExitComplete={() => void controller.acknowledgeClosed()}>
        {visible && session ? (
          <motion.div
            key={session.id}
            role="dialog"
            aria-label="Circle to Search"
            aria-modal="true"
            className="absolute inset-0"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: tween.base }}
          >
            <motion.div
              className="absolute inset-0"
              animate={{ y: sceneOffset }}
              transition={sceneTransition}
            >
              <img
                src={session.imageUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-fill select-none"
              />
              <motion.div
                aria-hidden
                className="absolute inset-0 bg-black"
                initial={{ opacity: 0 }}
                animate={{ opacity: selection ? 0.12 : 0.22 }}
                transition={tween.slow}
              />
            </motion.div>

            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: selection ? 0.28 : 1 }}
              transition={tween.slow}
            >
              <div className="bk-screen-glow" />
              <div className="bk-screen-ring" />
            </motion.div>

            <DrawLayer />

            <motion.div
              className="pointer-events-none absolute inset-0"
              animate={{ y: sceneOffset }}
              transition={sceneTransition}
            >
              <SelectionBox />
              <TapPulse />
            </motion.div>

            <HintPill />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <ResultsSheet />
    </div>
  );
}

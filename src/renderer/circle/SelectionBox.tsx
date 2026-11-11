import { motion } from 'framer-motion';
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { spring } from '@renderer/motion/tokens';
import { useController } from './context';
import { dragRect, nudgeRect, type HandleEdge } from './gestures';
import { useCircleStore } from './store';

const KEYBOARD_STEP = 8;

interface HandleSpec {
  edge: HandleEdge;
  className: string;
  cursor: string;
  knob: boolean;
}

const HANDLES: readonly HandleSpec[] = [
  { edge: 'n', className: 'left-4 right-4 -top-2 h-4', cursor: 'ns-resize', knob: false },
  { edge: 's', className: 'left-4 right-4 -bottom-2 h-4', cursor: 'ns-resize', knob: false },
  { edge: 'w', className: 'top-4 bottom-4 -left-2 w-4', cursor: 'ew-resize', knob: false },
  { edge: 'e', className: 'top-4 bottom-4 -right-2 w-4', cursor: 'ew-resize', knob: false },
  { edge: 'nw', className: '-left-3.5 -top-3.5 h-7 w-7', cursor: 'nwse-resize', knob: true },
  { edge: 'ne', className: '-right-3.5 -top-3.5 h-7 w-7', cursor: 'nesw-resize', knob: true },
  { edge: 'sw', className: '-left-3.5 -bottom-3.5 h-7 w-7', cursor: 'nesw-resize', knob: true },
  { edge: 'se', className: '-right-3.5 -bottom-3.5 h-7 w-7', cursor: 'nwse-resize', knob: true },
];

/**
 * The rounded selection: glowing animated border, everything outside darkened (a huge box-shadow),
 * glowing corner handles to resize and a body to move it. Arrow keys move it, Shift+arrows resize.
 */
export function SelectionBox() {
  const controller = useController();
  const reduceMotion = useReduceMotion();
  const selection = useCircleStore((state) => state.selection);
  const selectionId = useCircleStore((state) => state.selectionId);
  const source = useCircleStore((state) => state.selectionSource);
  const box = useRef<HTMLDivElement>(null);

  // Keyboard-created selections take focus so the arrow keys work straight away.
  useEffect(() => {
    if (source === 'keyboard') box.current?.focus();
  }, [selectionId, source]);

  if (!selection) return null;

  const startDrag = (edge: HandleEdge) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY, rect: selection };
    const bounds = { width: window.innerWidth, height: window.innerHeight };
    let latest = selection;
    const onMove = (move: PointerEvent): void => {
      latest = dragRect(
        edge,
        origin.rect,
        move.clientX - origin.x,
        move.clientY - origin.y,
        bounds,
      );
      controller.adjustSelection(latest, false);
    };
    const onEnd = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
      controller.adjustSelection(latest, true);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const bounds = { width: window.innerWidth, height: window.innerHeight };
    const next = nudgeRect(selection, event.key, {
      resize: event.shiftKey,
      step: event.ctrlKey ? 1 : KEYBOARD_STEP,
      bounds,
    });
    if (next) {
      event.preventDefault();
      controller.adjustSelection(next, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      controller.retryOcr();
    }
  };

  return (
    <motion.div
      key={selectionId}
      ref={box}
      data-testid="circle-selection"
      role="group"
      tabIndex={0}
      aria-label="Selected area. Arrow keys move it, Shift with arrow keys resizes it, Enter reads the text again."
      className="pointer-events-auto absolute rounded-[18px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4"
      style={{
        left: selection.x,
        top: selection.y,
        width: selection.width,
        height: selection.height,
        boxShadow:
          '0 0 0 100vmax rgba(4, 4, 10, 0.64), 0 0 34px 6px rgba(255, 179, 0, 0.28), 0 0 70px 14px rgba(124, 77, 255, 0.22)',
      }}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...spring.soft, delay: reduceMotion || source !== 'lasso' ? 0 : 0.2 }}
      onKeyDown={onKeyDown}
    >
      <div className="bk-selection-ring" />
      <div
        className="absolute inset-0 rounded-[18px]"
        style={{ cursor: 'move' }}
        onPointerDown={startDrag('move')}
      />
      {HANDLES.map((handle) => (
        <div
          key={handle.edge}
          className={`absolute z-10 flex items-center justify-center ${handle.className}`}
          style={{ cursor: handle.cursor, touchAction: 'none' }}
          onPointerDown={startDrag(handle.edge)}
        >
          {handle.knob ? (
            <span
              aria-hidden
              className="h-3 w-3 rounded-full bg-white"
              style={{ boxShadow: '0 0 0 2px #ffb300, 0 0 12px 3px rgba(255, 179, 0, 0.75)' }}
            />
          ) : null}
        </div>
      ))}
    </motion.div>
  );
}

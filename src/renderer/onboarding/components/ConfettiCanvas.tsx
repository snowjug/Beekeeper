import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { runConfetti } from '../confettiCanvas';

/**
 * Full-window honey confetti. It is portalled to <body> so no transformed ancestor (the sliding
 * screen) can shrink or move the `fixed` canvas, and it never takes pointer events.
 */
export function ConfettiCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    return element ? runConfetti(element) : undefined;
  }, []);

  return createPortal(
    <canvas
      ref={canvas}
      aria-hidden
      data-celebration="confetti"
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />,
    document.body,
  );
}

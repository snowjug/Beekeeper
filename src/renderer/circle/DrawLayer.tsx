import { useEffect, useRef } from 'react';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { useController } from './context';
import { DrawEngine } from './drawEngine';

/** Full-screen canvas that receives pointer gestures (mouse, pen, touch) and draws the lasso. */
export function DrawLayer() {
  const controller = useController();
  const reduceMotion = useReduceMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<DrawEngine | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const drawing = new DrawEngine(
      element,
      {
        onBegin: () => controller.beginGesture(),
        onSelect: (rect, source) => controller.selectRegion(rect, source),
        onTap: (point) => void controller.tapAt(point),
        onIgnore: () => controller.gestureIgnored(),
      },
      { calm: reduceMotion },
    );
    const fit = (): void =>
      drawing.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    fit();
    window.addEventListener('resize', fit);
    engine.current = drawing;
    return () => {
      window.removeEventListener('resize', fit);
      drawing.dispose();
      engine.current = null;
    };
  }, [controller, reduceMotion]);

  return (
    <canvas
      ref={canvas}
      data-testid="circle-canvas"
      aria-hidden
      className="absolute inset-0 h-full w-full touch-none"
      style={{ cursor: 'crosshair' }}
      onPointerDown={(event) => engine.current?.pointerDown(event.nativeEvent)}
      onPointerMove={(event) => engine.current?.pointerMove(event.nativeEvent)}
      onPointerUp={(event) => engine.current?.pointerUp(event.nativeEvent)}
      onPointerCancel={() => engine.current?.pointerCancel()}
    />
  );
}

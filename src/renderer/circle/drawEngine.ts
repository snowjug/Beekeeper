import {
  resampleToCount,
  roundedRectOutline,
  signedArea,
  type Point,
  type Rect,
} from '@shared/geometry';
import { Spring, clamp } from '@renderer/motion/math';
import { Brush } from './brush';
import { classifyGesture, smoothPath, type StrokePoint } from './gestures';

export interface DrawCallbacks {
  /** A new stroke started (previous selection and results should be dismissed). */
  onBegin: () => void;
  onSelect: (rect: Rect, source: 'lasso' | 'rect') => void;
  onTap: (point: Point) => void;
  /** The stroke was too small to select anything. */
  onIgnore: () => void;
}

export interface DrawOptions {
  /** prefers-reduced-motion: no sparkles, no colour flow, no morph animation. */
  calm: boolean;
}

const MORPH_POINTS = 300;
const CORNER_RADIUS = 18;
const BORDER_WIDTH = 3.5;
const MORPH_SPRING = { stiffness: 170, damping: 15 };
const HOLD_SECONDS = 0.16;
const FADE_SECONDS = 0.3;

interface Morph {
  from: Point[];
  to: Point[];
  spring: Spring;
  hold: number;
  fade: number;
}

interface Gesture {
  pointerId: number;
  rectangleMode: boolean;
  points: StrokePoint[];
}

function toStrokePoint(event: PointerEvent): StrokePoint {
  return {
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    pressure: event.pointerType === 'pen' ? event.pressure || 0.5 : 0.5,
  };
}

/**
 * Pointer gestures + canvas animation of the lasso. Owns one requestAnimationFrame loop that runs
 * only while a stroke is being drawn, sparkles are fading or the stroke is morphing into the
 * selection outline; otherwise the page is completely idle.
 */
export class DrawEngine {
  private readonly brush: Brush;
  private gesture: Gesture | null = null;
  private morph: Morph | null = null;
  private frame = 0;
  private last = 0;
  private viewport = { width: 0, height: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: DrawCallbacks,
    private readonly options: DrawOptions,
  ) {
    this.brush = new Brush(canvas, { calm: options.calm });
  }

  resize(width: number, height: number, dpr: number): void {
    this.viewport = { width, height };
    this.brush.resize(width, height, dpr);
  }

  pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture) return;
    this.cancelMorph();
    this.brush.clear();
    this.canvas.setPointerCapture(event.pointerId);
    const point = toStrokePoint(event);
    this.gesture = {
      pointerId: event.pointerId,
      rectangleMode: event.shiftKey,
      points: [point],
    };
    this.brush.begin(point);
    this.callbacks.onBegin();
    this.ensureLoop();
  }

  pointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const samples = event.getCoalescedEvents?.() ?? [];
    const events = samples.length > 0 ? samples : [event];
    for (const sample of events) {
      const point = toStrokePoint(sample);
      gesture.points.push(point);
      this.brush.extend(point);
    }
  }

  pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.gesture = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    gesture.points.push(toStrokePoint(event));
    const result = classifyGesture(gesture.points, {
      rectangleMode: gesture.rectangleMode,
      bounds: this.viewport,
    });

    if (result.kind === 'selection') {
      if (!this.options.calm && result.source === 'lasso') this.startMorph(result.rect);
      else this.brush.clear();
      this.callbacks.onSelect(result.rect, result.source);
    } else if (result.kind === 'tap') {
      this.brush.clear();
      this.callbacks.onTap(result.point);
    } else {
      this.brush.clear();
      this.callbacks.onIgnore();
    }
    this.ensureLoop();
  }

  /** The stroke was interrupted (pointer cancel, window blur): nothing is selected. */
  pointerCancel(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.brush.clear();
    this.callbacks.onIgnore();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.gesture = null;
    this.morph = null;
  }

  private startMorph(rect: Rect): void {
    const smooth = smoothPath(this.brush.strokePoints);
    if (smooth.length < 3) {
      this.brush.clear();
      return;
    }
    const from = resampleToCount(smooth, MORPH_POINTS, true);
    const to = roundedRectOutline(rect, CORNER_RADIUS, MORPH_POINTS, {
      startNear: from[0] ?? smooth[0],
      clockwise: signedArea(from) >= 0,
    });
    const spring = new Spring(0, MORPH_SPRING);
    spring.target = 1;
    this.morph = { from, to, spring, hold: HOLD_SECONDS, fade: 1 };
  }

  private cancelMorph(): void {
    this.morph = null;
  }

  private ensureLoop(): void {
    if (this.frame !== 0) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.brush.step(dt);

    let active = false;
    if (this.morph) {
      active = this.advanceMorph(this.morph, dt);
      if (!active) {
        this.morph = null;
        this.brush.clear();
      }
    } else if (this.gesture) {
      this.drawLive(this.gesture);
      active = true;
    } else if (this.brush.busy) {
      this.brush.drawStroke();
      active = true;
    }
    if (active) this.frame = requestAnimationFrame(this.tick);
  };

  private drawLive(gesture: Gesture): void {
    if (!gesture.rectangleMode) {
      this.brush.drawStroke();
      return;
    }
    const first = gesture.points[0];
    const last = gesture.points[gesture.points.length - 1];
    if (!first || !last) return;
    const rect = {
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      width: Math.abs(last.x - first.x),
      height: Math.abs(last.y - first.y),
    };
    const outline = roundedRectOutline(
      rect,
      Math.min(CORNER_RADIUS, rect.width / 2, rect.height / 2),
      MORPH_POINTS,
    );
    this.brush.drawMorph(outline, outline, 1, 1, BORDER_WIDTH);
  }

  /** Returns false once the morph, the hold and the fade-out are over. */
  private advanceMorph(morph: Morph, dt: number): boolean {
    const t = morph.spring.step(dt);
    if (!morph.spring.settled) {
      this.brush.drawMorph(morph.from, morph.to, t, 1, BORDER_WIDTH);
      return true;
    }
    if (morph.hold > 0) {
      morph.hold -= dt;
      this.brush.drawMorph(morph.from, morph.to, 1, 1, BORDER_WIDTH);
      return true;
    }
    morph.fade -= dt / FADE_SECONDS;
    if (morph.fade <= 0) return false;
    this.brush.drawMorph(morph.from, morph.to, 1, morph.fade, BORDER_WIDTH);
    return true;
  }
}

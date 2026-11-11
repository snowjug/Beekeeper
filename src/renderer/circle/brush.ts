import { BRAND_COLORS } from '@shared/constants';
import { morphPoints, strokeWidthForVelocity, type Point } from '@shared/geometry';
import { clamp, hexToRgb, rgbToCss, samplePalette, type Rgb } from '@renderer/motion/math';
import { smoothPath, type StrokePoint } from './gestures';

const PALETTE: readonly Rgb[] = [
  hexToRgb(BRAND_COLORS.honey),
  hexToRgb(BRAND_COLORS.coral),
  hexToRgb(BRAND_COLORS.violet),
  hexToRgb(BRAND_COLORS.cyan),
];

const WIDTH_RANGE = { min: 3.2, max: 9 };
const FLOW_SPEED = 0.55;
const MAX_SPARKLES = 150;
const RUN_LENGTH = 5;

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  hue: number;
}

export interface BrushOptions {
  /** No sparkles and no colour flow (prefers-reduced-motion). */
  calm: boolean;
  /** Deterministic randomness for tests. */
  random?: () => number;
}

/** Width easing with pointer speed (and pen pressure) for the next sample. */
export function widthFor(previousWidth: number, velocityPxPerMs: number, pressure: number): number {
  const target = strokeWidthForVelocity(velocityPxPerMs, WIDTH_RANGE) * (0.65 + 0.7 * pressure);
  return previousWidth + (target - previousWidth) * 0.35;
}

/**
 * Draws the Circle-to-Search lasso: a glowing four-colour gradient stroke whose width eases with
 * pointer speed, a sparkle trail, and the morph of the stroke into the selection outline. All
 * state is mutable and drawn from a single requestAnimationFrame loop owned by the caller.
 */
export class Brush {
  private readonly context: CanvasRenderingContext2D;
  private points: StrokePoint[] = [];
  private widths: number[] = [];
  private sparkles: Sparkle[] = [];
  private phase = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private readonly random: () => number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: BrushOptions,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available.');
    this.context = context;
    this.random = options.random ?? Math.random;
  }

  /** Matches the backing store to the CSS size and device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  begin(point: StrokePoint): void {
    this.points = [point];
    this.widths = [WIDTH_RANGE.max];
  }

  extend(point: StrokePoint): void {
    const previous = this.points[this.points.length - 1];
    if (!previous) {
      this.begin(point);
      return;
    }
    const elapsed = Math.max(1, point.t - previous.t);
    const velocity = Math.hypot(point.x - previous.x, point.y - previous.y) / elapsed;
    const width = widthFor(
      this.widths[this.widths.length - 1] ?? WIDTH_RANGE.max,
      velocity,
      point.pressure,
    );
    this.points.push(point);
    this.widths.push(width);
    if (!this.options.calm) this.emit(point, velocity);
  }

  get strokePoints(): readonly StrokePoint[] {
    return this.points;
  }

  /** True while there is still something to animate (sparkles fading out). */
  get busy(): boolean {
    return this.sparkles.length > 0;
  }

  clear(): void {
    this.points = [];
    this.widths = [];
    this.sparkles = [];
    this.context.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  /** Advances sparkles and the colour flow by `dt` seconds. */
  step(dt: number): void {
    if (!this.options.calm) this.phase += dt * FLOW_SPEED;
    for (const sparkle of this.sparkles) {
      sparkle.age += dt;
      sparkle.x += sparkle.vx * dt;
      sparkle.y += sparkle.vy * dt;
      sparkle.vy += 60 * dt;
    }
    this.sparkles = this.sparkles.filter((sparkle) => sparkle.age < sparkle.life);
  }

  /** Draws the live stroke (and sparkles). */
  drawStroke(): void {
    const { context } = this;
    context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const path = smoothPath(this.points);
    this.paintPath(path, this.widthsAlong(path.length), false, 1);
    this.paintSparkles();
  }

  /** Draws the stroke morphing into the selection outline (`t` 0..1) while it fades out. */
  drawMorph(
    from: readonly Point[],
    to: readonly Point[],
    t: number,
    alpha: number,
    borderWidth: number,
  ): void {
    const { context } = this;
    context.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const eased = clamp(t, 0, 1.2);
    const path = morphPoints(from, to, eased);
    const startWidth = this.widths.length > 0 ? average(this.widths) : WIDTH_RANGE.max;
    const width = startWidth + (borderWidth - startWidth) * clamp(t, 0, 1);
    this.paintPath(path, new Array<number>(path.length).fill(width), true, alpha);
    this.paintSparkles();
  }

  private widthsAlong(count: number): number[] {
    const source = this.widths;
    if (source.length === 0 || count === 0) return [];
    return Array.from({ length: count }, (_, index) => {
      const position = count === 1 ? 0 : (index / (count - 1)) * (source.length - 1);
      const low = Math.floor(position);
      const high = Math.min(source.length - 1, low + 1);
      const a = source[low] ?? WIDTH_RANGE.max;
      const b = source[high] ?? a;
      return a + (b - a) * (position - low);
    });
  }

  private paintPath(
    path: readonly Point[],
    widths: readonly number[],
    closed: boolean,
    alpha: number,
  ): void {
    const { context } = this;
    const count = path.length;
    if (count < 2) return;
    context.save();
    context.lineJoin = 'round';

    const passes = [
      { scale: 3.4, alpha: 0.1, white: false },
      { scale: 1.9, alpha: 0.2, white: false },
      { scale: 1, alpha: 1, white: false },
      { scale: 0.32, alpha: 0.7, white: true },
    ];
    for (const pass of passes) {
      // Translucent passes use butt caps: round caps would overlap at every run and look beaded.
      context.lineCap = pass.alpha < 1 ? 'butt' : 'round';
      for (let start = 0; start < count - 1; start += RUN_LENGTH) {
        const end = Math.min(count - 1, start + RUN_LENGTH);
        const progress = count > 1 ? start / (count - 1) : 0;
        const color = pass.white
          ? { r: 255, g: 255, b: 255 }
          : samplePalette(PALETTE, progress * 1.6 + this.phase);
        context.strokeStyle = rgbToCss(color, clamp(pass.alpha * alpha, 0, 1));
        context.lineWidth = (widths[start] ?? WIDTH_RANGE.max) * pass.scale;
        context.beginPath();
        const first = path[start];
        if (!first) continue;
        context.moveTo(first.x, first.y);
        for (let index = start + 1; index <= end; index += 1) {
          const point = path[index];
          if (point) context.lineTo(point.x, point.y);
        }
        context.stroke();
      }
      if (closed) {
        const last = path[count - 1];
        const first = path[0];
        if (last && first) {
          context.strokeStyle = rgbToCss(
            pass.white ? { r: 255, g: 255, b: 255 } : samplePalette(PALETTE, this.phase),
            clamp(pass.alpha * alpha, 0, 1),
          );
          context.lineWidth = (widths[count - 1] ?? WIDTH_RANGE.max) * pass.scale;
          context.beginPath();
          context.moveTo(last.x, last.y);
          context.lineTo(first.x, first.y);
          context.stroke();
        }
      }
    }
    context.restore();
  }

  private paintSparkles(): void {
    if (this.sparkles.length === 0) return;
    const { context } = this;
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const sparkle of this.sparkles) {
      const life = 1 - sparkle.age / sparkle.life;
      const color = samplePalette(PALETTE, sparkle.hue + this.phase);
      const size = sparkle.size * (0.5 + life);
      context.strokeStyle = rgbToCss(color, clamp(life, 0, 1));
      context.fillStyle = rgbToCss(color, clamp(life * 0.9, 0, 1));
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(sparkle.x, sparkle.y, size * 0.45, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(sparkle.x - size, sparkle.y);
      context.lineTo(sparkle.x + size, sparkle.y);
      context.moveTo(sparkle.x, sparkle.y - size);
      context.lineTo(sparkle.x, sparkle.y + size);
      context.stroke();
    }
    context.restore();
  }

  private emit(point: Point, velocityPxPerMs: number): void {
    const count = velocityPxPerMs > 0.3 ? 2 : 1;
    for (let index = 0; index < count && this.sparkles.length < MAX_SPARKLES; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const speed = 20 + this.random() * 60;
      this.sparkles.push({
        x: point.x + (this.random() - 0.5) * 6,
        y: point.y + (this.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        age: 0,
        life: 0.45 + this.random() * 0.5,
        size: 2 + this.random() * 3,
        hue: this.random() * PALETTE.length,
      });
    }
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

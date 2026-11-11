/** Small numeric helpers shared by the canvas/SVG animations (pure, unit tested). */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** Critically/under-damped spring integrated with small fixed sub-steps for stability. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(
    initial: number,
    public config: SpringConfig = { stiffness: 220, damping: 26 },
  ) {
    this.value = initial;
    this.target = initial;
  }

  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  step(dt: number): number {
    const { stiffness, damping, mass = 1 } = this.config;
    const substep = 1 / 240;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-9) {
      const h = Math.min(substep, remaining);
      const force = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    return this.value;
  }

  get settled(): boolean {
    return Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.0005;
  }
}

/**
 * Frame-rate independent smoothing with separate attack (rising) and release (falling) time
 * constants in seconds. Used for audio levels so bars jump up fast and fall slowly.
 */
export function smoothTowards(
  current: number,
  target: number,
  dt: number,
  attackSeconds: number,
  releaseSeconds: number,
): number {
  const tau = target > current ? attackSeconds : releaseSeconds;
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-dt / tau);
  return current + (target - current) * alpha;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean,
    16,
  );
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToCss({ r, g, b }: Rgb, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
    : `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${alpha})`;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

/** Smoothly cycles through `colors` as `phase` increases (phase 1 = next colour, wraps). */
export function samplePalette(colors: readonly Rgb[], phase: number): Rgb {
  const count = colors.length;
  const wrapped = ((phase % count) + count) % count;
  const index = Math.floor(wrapped);
  const from = colors[index] ?? colors[0];
  const to = colors[(index + 1) % count] ?? colors[0];
  if (!from || !to) return { r: 0, g: 0, b: 0 };
  const t = wrapped - index;
  // Ease so colours linger a little instead of constantly blending.
  const eased = t * t * (3 - 2 * t);
  return mixRgb(from, to, eased);
}

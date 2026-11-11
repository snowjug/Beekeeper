import { BRAND_COLORS } from '@shared/constants';

/** Deterministic random numbers in [0, 1) so the physics can be unit tested. */
export type Rng = () => number;

export type ParticleShape = 'hexagon' | 'circle';

export interface Particle {
  x: number;
  y: number;
  /** px per second */
  vx: number;
  vy: number;
  rotation: number;
  /** radians per second */
  spin: number;
  /** Phase and rate of the paper-flutter squash used when drawing. */
  flip: number;
  flipSpeed: number;
  /** Radius in px. */
  size: number;
  color: string;
  shape: ParticleShape;
  age: number;
  life: number;
}

export interface Physics {
  /** px / s^2 */
  gravity: number;
  /** Velocity decay per second (air drag). */
  drag: number;
}

export interface BurstOptions {
  count: number;
  x: number;
  y: number;
  /** Direction in radians (0 = right, -PI/2 = up). */
  angle: number;
  /** Half the width of the cone around `angle`. */
  spread: number;
  minSpeed: number;
  maxSpeed: number;
  minLife: number;
  maxLife: number;
}

export const DEFAULT_PHYSICS: Physics = { gravity: 720, drag: 2.4 };

/** The burst is over after this many seconds (the longest particle life). */
export const CONFETTI_SECONDS = 2.5;

/** Honey leads the palette; the other three brand colours accompany it. */
export const CONFETTI_COLORS: readonly string[] = [
  BRAND_COLORS.honey,
  BRAND_COLORS.honey,
  BRAND_COLORS.coral,
  BRAND_COLORS.violet,
  BRAND_COLORS.cyan,
];

const FADE_FRACTION = 0.4;

/** mulberry32: tiny, fast and good enough for visual randomness. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function createParticles(rng: Rng, options: BurstOptions): Particle[] {
  const particles: Particle[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const direction = options.angle + (rng() * 2 - 1) * options.spread;
    const speed = between(rng, options.minSpeed, options.maxSpeed);
    particles.push({
      x: options.x,
      y: options.y,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed,
      rotation: rng() * Math.PI * 2,
      spin: between(rng, -7, 7),
      flip: rng() * Math.PI * 2,
      flipSpeed: between(rng, 4, 11),
      size: between(rng, 5, 10),
      color: CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)] ?? BRAND_COLORS.honey,
      shape: rng() < 0.55 ? 'hexagon' : 'circle',
      age: 0,
      life: between(rng, options.minLife, options.maxLife),
    });
  }
  return particles;
}

/**
 * One physics step with drag and gravity, integrated exactly (closed form), so the motion does not
 * depend on the frame rate. Mutates the particle: the hot loop allocates nothing.
 */
export function stepParticle(
  particle: Particle,
  dt: number,
  physics: Physics = DEFAULT_PHYSICS,
): void {
  const { gravity, drag } = physics;
  if (drag > 0) {
    const decay = Math.exp(-drag * dt);
    const travel = (1 - decay) / drag;
    const terminal = gravity / drag;
    particle.x += particle.vx * travel;
    particle.y += terminal * dt + (particle.vy - terminal) * travel;
    particle.vx *= decay;
    particle.vy = terminal + (particle.vy - terminal) * decay;
  } else {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt + 0.5 * gravity * dt * dt;
    particle.vy += gravity * dt;
  }
  particle.rotation += particle.spin * dt;
  particle.spin *= Math.exp(-Math.max(0, drag) * 0.4 * dt);
  particle.flip += particle.flipSpeed * dt;
  particle.age += dt;
}

export function isAlive(particle: Particle): boolean {
  return particle.age < particle.life;
}

/** Steps every particle and returns the ones that are still alive. */
export function stepParticles(
  particles: readonly Particle[],
  dt: number,
  physics: Physics = DEFAULT_PHYSICS,
): Particle[] {
  for (const particle of particles) stepParticle(particle, dt, physics);
  return particles.filter(isAlive);
}

/** Fully opaque for most of the life, then a smooth fade-out over the final 40 %. */
export function particleOpacity(particle: Particle): number {
  const remaining = (particle.life - particle.age) / (particle.life * FADE_FRACTION);
  return Math.min(1, Math.max(0, remaining));
}

/** Vertical squash (0.3..1) that makes a hexagon look like it tumbles in 3D. */
export function flutterScale(particle: Particle): number {
  return 0.3 + 0.7 * Math.abs(Math.cos(particle.flip));
}

/** The celebration: one radial pop at the orb plus two cannons from the bottom corners. */
export function createCelebration(rng: Rng, width: number, height: number): Particle[] {
  const burst = {
    minLife: CONFETTI_SECONDS * 0.64,
    maxLife: CONFETTI_SECONDS,
  };
  return [
    ...createParticles(rng, {
      ...burst,
      count: 70,
      x: width / 2,
      y: height * 0.26,
      angle: -Math.PI / 2,
      spread: Math.PI,
      minSpeed: 380,
      maxSpeed: 980,
    }),
    ...createParticles(rng, {
      ...burst,
      count: 40,
      x: width * 0.03,
      y: height * 0.97,
      angle: -1.15,
      spread: 0.32,
      minSpeed: 900,
      maxSpeed: 1500,
    }),
    ...createParticles(rng, {
      ...burst,
      count: 40,
      x: width * 0.97,
      y: height * 0.97,
      angle: -(Math.PI - 1.15),
      spread: 0.32,
      minSpeed: 900,
      maxSpeed: 1500,
    }),
  ];
}

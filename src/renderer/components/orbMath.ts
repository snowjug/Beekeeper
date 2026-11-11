import { BRAND_COLORS } from '@shared/constants';
import { clamp, hexToRgb, rgbToCss, samplePalette, type Rgb } from '@renderer/motion/math';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export const ORB_STATES: readonly OrbState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'error',
] as const;

export const PARTICLE_COUNT = 4;

/** Geometry is expressed in a 100 x 100 viewBox. */
export const ORB_VIEWBOX = 100;
const CENTER = 50;
const DOT = 15;
const SPACING = 21;
const BAR_MAX_HEIGHT = 74;
const BAR_WIDTH = 12.5;

const PALETTE: readonly Rgb[] = [
  hexToRgb(BRAND_COLORS.honey),
  hexToRgb(BRAND_COLORS.coral),
  hexToRgb(BRAND_COLORS.violet),
  hexToRgb(BRAND_COLORS.cyan),
];
const CORAL = PALETTE[1] ?? { r: 255, g: 90, b: 95 };

export interface ParticleTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrbFrameInput {
  state: OrbState;
  /** Seconds since the animation started. */
  time: number;
  /** Seconds since the current state was entered. */
  stateAge: number;
  /** Smoothed microphone level 0..1. */
  level: number;
  /** TTS boundary pulse 0..1 (decays). */
  pulse: number;
}

export interface OrbFrame {
  particles: ParticleTarget[];
  /** 0 = crisp shapes, 1 = fully gooey merge. */
  goo: number;
  /** Colours (css) per particle. */
  colors: string[];
}

const BAR_GAINS = [0.72, 1, 0.86, 0.62] as const;

function rowX(index: number): number {
  return CENTER + (index - (PARTICLE_COUNT - 1) / 2) * SPACING;
}

function paletteColor(index: number, phase: number): string {
  return rgbToCss(samplePalette(PALETTE, index + phase));
}

/** Pure description of where every particle should be for a frame. */
export function computeOrbFrame(input: OrbFrameInput): OrbFrame {
  const { state, time, stateAge, level, pulse } = input;
  const particles: ParticleTarget[] = [];
  const colors: string[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    switch (state) {
      case 'idle': {
        const breathe = 0.975 + 0.075 * Math.sin(2 * Math.PI * (time / 2.6 + i * 0.11));
        const size = DOT * breathe;
        particles.push({ x: rowX(i), y: CENTER, width: size, height: size });
        colors.push(paletteColor(i, 0));
        break;
      }
      case 'listening': {
        const wobble = 0.5 + 0.5 * Math.sin(time * (5.3 + i * 1.7) + i * 1.9);
        const gain = BAR_GAINS[i] ?? 1;
        const energy = clamp(level * gain * (0.55 + 0.45 * wobble) + 0.05 * wobble, 0, 1);
        const height = Math.max(DOT, DOT + (BAR_MAX_HEIGHT - DOT) * energy);
        particles.push({ x: rowX(i), y: CENTER, width: BAR_WIDTH, height });
        colors.push(paletteColor(i, 0));
        break;
      }
      case 'thinking': {
        const angle = time * 2.4 + (i * Math.PI) / 2;
        const radius = 11 + 8 * Math.sin(time * 1.3);
        particles.push({
          x: CENTER + radius * Math.cos(angle),
          y: CENTER + radius * Math.sin(angle),
          width: 19,
          height: 19,
        });
        colors.push(paletteColor(i, time * 0.45));
        break;
      }
      case 'speaking': {
        const angle = time * 1.6 + (i * Math.PI) / 2;
        const radius = 5 + 2 * Math.sin(time * 2 + i);
        const size = 24 + 9 * clamp(pulse, 0, 1) + 2 * Math.sin(time * 4 + i);
        particles.push({
          x: CENTER + radius * Math.cos(angle),
          y: CENTER + radius * Math.sin(angle),
          width: size,
          height: size,
        });
        colors.push(paletteColor(i, time * 0.25));
        break;
      }
      case 'error': {
        const shake = 4 * Math.sin(stateAge * 38) * Math.exp(-stateAge * 5);
        particles.push({ x: rowX(i) + shake, y: CENTER, width: DOT, height: DOT });
        colors.push(rgbToCss(CORAL));
        break;
      }
    }
  }

  return { particles, goo: state === 'thinking' || state === 'speaking' ? 1 : 0, colors };
}

export function describeOrbState(state: OrbState): string {
  switch (state) {
    case 'idle':
      return 'Beekeeper is idle';
    case 'listening':
      return 'Beekeeper is listening';
    case 'thinking':
      return 'Beekeeper is thinking';
    case 'speaking':
      return 'Beekeeper is speaking';
    case 'error':
      return 'Beekeeper hit an error';
  }
}

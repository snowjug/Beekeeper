import { motion } from 'framer-motion';
import { useEffect, useId, useMemo, useRef, type MutableRefObject } from 'react';
import { Spring, type SpringConfig } from '@renderer/motion/math';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import {
  computeOrbFrame,
  describeOrbState,
  ORB_VIEWBOX,
  PARTICLE_COUNT,
  type OrbState,
} from './orbMath';

export interface OrbProps {
  state: OrbState;
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Ref holding the smoothed mic level (0..1); read every frame without re-rendering. */
  levelRef?: MutableRefObject<number>;
  /** Increment on every TTS boundary event to pulse the blob. */
  pulseSignal?: number;
  className?: string;
  /** Hide from assistive tech when a nearby label already announces the state. */
  decorative?: boolean;
}

const POSITION_SPRING: SpringConfig = { stiffness: 240, damping: 22 };
const SIZE_SPRING: SpringConfig = { stiffness: 320, damping: 26 };
const BAR_SPRING: SpringConfig = { stiffness: 700, damping: 36 };
const GOO_SPRING: SpringConfig = { stiffness: 90, damping: 16 };
const GOO_BLUR = 3.4;

interface ParticleSim {
  x: Spring;
  y: Spring;
  width: Spring;
  height: Spring;
}

const GLOW: Record<OrbState, { opacity: number; scale: number; color: string }> = {
  idle: { opacity: 0.12, scale: 0.9, color: 'var(--bk-honey)' },
  listening: { opacity: 0.6, scale: 1.25, color: 'var(--bk-violet)' },
  thinking: { opacity: 0.4, scale: 1.1, color: 'var(--bk-cyan)' },
  speaking: { opacity: 0.5, scale: 1.2, color: 'var(--bk-honey)' },
  error: { opacity: 0.45, scale: 1.1, color: 'var(--bk-coral)' },
};

/**
 * The Beekeeper orb: four coloured dots that breathe (idle), turn into audio-reactive bars
 * (listening), orbit and merge into a gooey blob (thinking), pulse with speech (speaking)
 * and shake in coral on errors. Shapes are springs driven from one rAF loop that writes SVG
 * attributes directly, so React never re-renders at 60 fps.
 */
export function Orb({
  state,
  size = 44,
  levelRef,
  pulseSignal = 0,
  className,
  decorative = false,
}: OrbProps) {
  const reduceMotion = useReduceMotion();
  const filterId = `orb-goo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const rects = useRef<Array<SVGRectElement | null>>([]);
  const group = useRef<SVGGElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const fallbackLevel = useRef(0);
  const pulse = useRef(0);
  const enteredAt = useRef(0);
  const clock = useRef(0);
  const goo = useRef(new Spring(0, GOO_SPRING));

  const initial = useMemo(
    () => computeOrbFrame({ state, time: 0, stateAge: 0, level: 0, pulse: 0 }),
    // Only the very first frame is derived from props; afterwards the loop owns the attributes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const sims = useRef<ParticleSim[]>([]);
  if (sims.current.length === 0) {
    sims.current = initial.particles.map((p) => ({
      x: new Spring(p.x, POSITION_SPRING),
      y: new Spring(p.y, POSITION_SPRING),
      width: new Spring(p.width, SIZE_SPRING),
      height: new Spring(p.height, SIZE_SPRING),
    }));
  }

  useEffect(() => {
    enteredAt.current = clock.current;
    const heightConfig = state === 'listening' ? BAR_SPRING : SIZE_SPRING;
    for (const sim of sims.current) sim.height.config = heightConfig;
  }, [state]);

  useEffect(() => {
    if (pulseSignal > 0) pulse.current = 1;
  }, [pulseSignal]);

  const apply = (dt: number, time: number, staticLevel?: number): void => {
    clock.current = time;
    const level = staticLevel ?? levelRef?.current ?? fallbackLevel.current;
    const frame = computeOrbFrame({
      state,
      time,
      stateAge: Math.max(0, time - enteredAt.current),
      level,
      pulse: pulse.current,
    });
    pulse.current *= Math.exp(-dt * 6);

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const sim = sims.current[i];
      const target = frame.particles[i];
      const rect = rects.current[i];
      if (!sim || !target || !rect) continue;
      sim.x.target = target.x;
      sim.y.target = target.y;
      sim.width.target = target.width;
      sim.height.target = target.height;
      const width = sim.width.step(dt);
      const height = sim.height.step(dt);
      const x = sim.x.step(dt);
      const y = sim.y.step(dt);
      rect.setAttribute('x', (x - width / 2).toFixed(2));
      rect.setAttribute('y', (y - height / 2).toFixed(2));
      rect.setAttribute('width', Math.max(0.1, width).toFixed(2));
      rect.setAttribute('height', Math.max(0.1, height).toFixed(2));
      rect.setAttribute('rx', (Math.min(width, height) / 2).toFixed(2));
      rect.setAttribute('fill', frame.colors[i] ?? 'currentColor');
    }

    goo.current.target = frame.goo;
    const amount = goo.current.step(dt);
    blur.current?.setAttribute('stdDeviation', (GOO_BLUR * amount).toFixed(2));
    if (amount > 0.02) group.current?.setAttribute('filter', `url(#${filterId})`);
    else group.current?.removeAttribute('filter');
  };

  // Idle breathing, listening bars, orbiting blob... all animated unless motion is reduced.
  useAnimationLoop((dt, time) => apply(dt, time), !reduceMotion);

  // Reduced motion: settle on one calm frame per state instead of looping.
  useEffect(() => {
    if (!reduceMotion) return;
    for (let step = 0; step < 90; step += 1) apply(1 / 60, 1, state === 'listening' ? 0.35 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, state]);

  const glow = GLOW[state];
  const label = describeOrbState(state);

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: 'relative', flex: 'none' }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-orb-state={state}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: '-45%',
          background: `radial-gradient(closest-side, ${glow.color}, transparent 72%)`,
        }}
        initial={false}
        animate={{ opacity: reduceMotion ? glow.opacity * 0.5 : glow.opacity, scale: glow.scale }}
        transition={{ type: 'spring', stiffness: 160, damping: 20 }}
      />
      <svg
        viewBox={`0 0 ${ORB_VIEWBOX} ${ORB_VIEWBOX}`}
        width={size}
        height={size}
        style={{ position: 'relative', overflow: 'visible' }}
        focusable="false"
        aria-hidden
      >
        <defs>
          <filter
            id={filterId}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur ref={blur} in="SourceGraphic" stdDeviation="0" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
        <g ref={group}>
          {initial.particles.map((particle, index) => (
            <rect
              key={index}
              ref={(element) => {
                rects.current[index] = element;
              }}
              x={particle.x - particle.width / 2}
              y={particle.y - particle.height / 2}
              width={particle.width}
              height={particle.height}
              rx={Math.min(particle.width, particle.height) / 2}
              fill={initial.colors[index]}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { BRAND_COLORS } from '@shared/constants';
import { clamp, smoothTowards } from '@renderer/motion/math';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';

export interface WaveformProps {
  /** Smoothed microphone level 0..1, updated by the voice pipeline. */
  levelRef: MutableRefObject<number>;
  /** Animate while true; bars decay to a flat line after it turns false. */
  active: boolean;
  height?: number;
  /** Number of bars. */
  bars?: number;
  className?: string;
}

const BAR_WIDTH = 3;
const BAR_GAP = 4;
const TAIL_MS = 700;

/** Per-bar target heights (0..1) derived from one RMS level, shaped by a bell envelope. */
export function waveformTargets(level: number, time: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const position = count === 1 ? 0.5 : i / (count - 1);
    const envelope = Math.exp(-Math.pow((position - 0.5) / 0.32, 2));
    const motion =
      0.55 + 0.25 * Math.sin(time * 6.1 + i * 0.9) + 0.2 * Math.sin(time * 9.7 + i * 1.7 + 1.3);
    out.push(clamp(level * envelope * motion * 1.25, 0, 1));
  }
  return out;
}

/**
 * Audio-reactive waveform on a canvas (60 fps, smoothed RMS). One gradient across the
 * brand palette, rounded bars, mirrored around the centre line, soft bloom via CSS.
 */
export function Waveform({ levelRef, active, height = 48, bars = 36, className }: WaveformProps) {
  const reduceMotion = useReduceMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const values = useRef(new Float32Array(bars));
  const [tail, setTail] = useState(active);

  useEffect(() => {
    if (active) {
      setTail(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setTail(false), TAIL_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    values.current = new Float32Array(bars);
  }, [bars]);

  useAnimationLoop((dt, time) => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = element.clientWidth;
    const cssHeight = height;
    if (
      element.width !== Math.round(cssWidth * dpr) ||
      element.height !== Math.round(cssHeight * dpr)
    ) {
      element.width = Math.round(cssWidth * dpr);
      element.height = Math.round(cssHeight * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    const level = active ? levelRef.current : 0;
    const targets = waveformTargets(level, time, bars);
    const step = BAR_WIDTH + BAR_GAP;
    const total = bars * step - BAR_GAP;
    const startX = (cssWidth - total) / 2;

    const gradient = context.createLinearGradient(startX, 0, startX + total, 0);
    gradient.addColorStop(0, BRAND_COLORS.honey);
    gradient.addColorStop(0.36, BRAND_COLORS.coral);
    gradient.addColorStop(0.68, BRAND_COLORS.violet);
    gradient.addColorStop(1, BRAND_COLORS.cyan);
    context.fillStyle = gradient;

    for (let i = 0; i < bars; i += 1) {
      const target = targets[i] ?? 0;
      const current = values.current[i] ?? 0;
      const next = smoothTowards(current, target, dt, 0.05, 0.22);
      values.current[i] = next;
      const barHeight = Math.max(BAR_WIDTH, next * (cssHeight - 4));
      const x = startX + i * step;
      const y = (cssHeight - barHeight) / 2;
      context.beginPath();
      context.roundRect(x, y, BAR_WIDTH, barHeight, BAR_WIDTH / 2);
      context.fill();
    }
  }, tail && !reduceMotion);

  return (
    <canvas
      ref={canvas}
      className={className}
      aria-hidden
      style={{
        width: '100%',
        height,
        display: 'block',
        filter: 'drop-shadow(0 0 10px color-mix(in srgb, var(--bk-violet) 55%, transparent))',
        opacity: reduceMotion ? 0 : 1,
      }}
    />
  );
}

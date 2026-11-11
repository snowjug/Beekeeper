import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Card } from '@renderer/components/Card';
import { Icon, type IconName } from '@renderer/components/Icon';
import { Orb } from '@renderer/components/Orb';
import type { OrbState } from '@renderer/components/orbMath';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { staggerContainer, staggerItem } from '@renderer/motion/variants';
import { ConfettiCanvas } from '../components/ConfettiCanvas';
import { Pill } from '../components/Pill';
import { Reveal, ScreenFrame } from '../components/ScreenFrame';
import type { Direction } from '../navigation';
import type { SummaryItem, SummaryTone } from '../summary';

const HAPPY_PULSES_MS = [0, 360, 780, 1280, 1900];
const SETTLE_MS = 2800;

const TRY_THESE: ReadonlyArray<{ icon: IconName; label: string }> = [
  { icon: 'weather', label: "What's the weather?" },
  { icon: 'app', label: 'Open Notepad' },
  { icon: 'circle', label: 'Circle to Search' },
];

const TONE_ICON: Record<SummaryTone, { icon: IconName; color: string }> = {
  good: { icon: 'check', color: 'text-success' },
  neutral: { icon: 'minus', color: 'text-fg-faint' },
  warn: { icon: 'warning', color: 'text-accent-text' },
};

/** The orb pulses like laughter in time with the confetti, then settles into the idle dots. */
function HappyOrb() {
  const reduceMotion = useReduceMotion();
  const [state, setState] = useState<OrbState>(reduceMotion ? 'idle' : 'speaking');
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const timers = HAPPY_PULSES_MS.map((delay) =>
      window.setTimeout(() => setPulse((count) => count + 1), delay),
    );
    timers.push(window.setTimeout(() => setState('idle'), SETTLE_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduceMotion]);

  return (
    <div className="relative">
      <Orb state={state} size={120} pulseSignal={pulse} decorative />
      {reduceMotion ? (
        <span
          aria-hidden
          data-celebration="sparkle"
          className="absolute -top-3 -right-9 text-accent-text"
        >
          <Icon name="sparkle" size={30} />
        </span>
      ) : null}
    </div>
  );
}

export interface DoneScreenProps {
  direction: Direction;
  summary: SummaryItem[];
}

export function DoneScreen({ direction, summary }: DoneScreenProps) {
  const reduceMotion = useReduceMotion();
  return (
    <ScreenFrame
      direction={direction}
      hero={<HappyOrb />}
      title={
        <>
          You’re <span className="bk-brand-text">all set</span>
        </>
      }
      description="Here’s how things stand. Everything can be changed later in Settings."
    >
      <Card index={1} lift={false} className="mt-5 w-full max-w-[560px] text-left">
        <ul aria-label="Setup summary" className="divide-y divide-line px-4">
          {summary.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <span className={TONE_ICON[item.tone].color}>
                <Icon name={TONE_ICON[item.tone].icon} size={18} />
              </span>
              <span className="text-[14px] font-semibold text-fg">{item.label}</span>
              <span className="ml-auto text-right text-[13px] text-fg-muted">{item.value}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Reveal className="mt-5">
        <h2 className="mb-2.5 text-[12px] font-semibold tracking-wide text-fg-muted uppercase">
          Try asking
        </h2>
      </Reveal>
      <motion.ul
        variants={staggerContainer}
        aria-label="Things to try"
        className="flex flex-wrap items-center justify-center gap-2.5"
      >
        {TRY_THESE.map((item) => (
          <motion.li key={item.label} variants={staggerItem}>
            <Pill icon={item.icon}>{item.label}</Pill>
          </motion.li>
        ))}
      </motion.ul>

      {reduceMotion ? null : <ConfettiCanvas />}
    </ScreenFrame>
  );
}

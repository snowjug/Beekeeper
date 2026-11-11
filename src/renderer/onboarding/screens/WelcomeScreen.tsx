import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { IconName } from '@renderer/components/Icon';
import { Orb } from '@renderer/components/Orb';
import type { OrbState } from '@renderer/components/orbMath';
import { spring } from '@renderer/motion/tokens';
import { useReduceMotion } from '@renderer/motion/useMotionPrefs';
import { staggerContainer, staggerItem } from '@renderer/motion/variants';
import { Pill } from '../components/Pill';
import { ScreenFrame } from '../components/ScreenFrame';
import type { Direction } from '../navigation';

const INTRO_MS = 1200;
const HERO_SIZE = 148;

const FEATURES: ReadonlyArray<{ icon: IconName; label: string }> = [
  { icon: 'mic', label: 'Voice & text commands' },
  { icon: 'circle', label: 'Circle to Search' },
  { icon: 'shield', label: 'Private by default, works offline' },
];

/**
 * The orb intro: four dots orbit and melt together, then spring apart into the breathing idle row
 * while the whole orb scales in. Played once per window; with reduced motion it is simply idle.
 */
function HeroOrb({ intro }: { intro: boolean }) {
  const reduceMotion = useReduceMotion();
  const playIntro = intro && !reduceMotion;
  const [state, setState] = useState<OrbState>(playIntro ? 'thinking' : 'idle');

  useEffect(() => {
    if (!playIntro) return undefined;
    const timer = window.setTimeout(() => setState('idle'), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [playIntro]);

  return (
    <div className="relative grid h-[208px] w-[208px] place-items-center">
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--bk-honey) 50%, transparent), color-mix(in srgb, var(--bk-violet) 26%, transparent) 55%, transparent 76%)',
        }}
        animate={reduceMotion ? undefined : { scale: [1, 1.12, 1], opacity: [0.55, 0.9, 0.55] }}
        transition={{ duration: 5.5, ease: 'easeInOut', repeat: Infinity }}
      />
      <motion.div
        initial={playIntro ? { scale: 0.3, opacity: 0, rotate: -40 } : false}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={spring.bouncy}
      >
        <Orb state={state} size={HERO_SIZE} decorative />
      </motion.div>
    </div>
  );
}

export interface WelcomeScreenProps {
  direction: Direction;
  /** True only for the first visit, so Back from the next screen does not replay the intro. */
  intro: boolean;
}

export function WelcomeScreen({ direction, intro }: WelcomeScreenProps) {
  return (
    <ScreenFrame
      direction={direction}
      hero={<HeroOrb intro={intro} />}
      title={
        <>
          Meet <span className="bk-brand-text">Beekeeper</span>
        </>
      }
      description="Your voice-first assistant for Windows. Press a hotkey, say what you need — or circle anything on your screen."
    >
      <motion.ul
        variants={staggerContainer}
        aria-label="Highlights"
        className="mt-7 flex flex-wrap items-center justify-center gap-2.5"
      >
        {FEATURES.map((feature) => (
          <motion.li key={feature.label} variants={staggerItem}>
            <Pill icon={feature.icon}>{feature.label}</Pill>
          </motion.li>
        ))}
      </motion.ul>
    </ScreenFrame>
  );
}

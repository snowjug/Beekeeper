import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { wordVariants } from '@renderer/motion/variants';

export interface TranscriptProps {
  partial: string;
  final: string;
  listening: boolean;
}

/**
 * Live transcript (spec 4.2): words fade in and de-blur one by one (25 ms stagger); when an
 * utterance is finished the locked-in text gets a short honey highlight.
 */
export function Transcript({ partial, final, listening }: TranscriptProps) {
  const words = useMemo(() => partial.split(/\s+/).filter(Boolean), [partial]);
  const lockedWords = useMemo(() => final.split(/\s+/).filter(Boolean), [final]);

  if (words.length === 0 && lockedWords.length === 0) {
    return (
      <p className="text-[17px] text-fg-muted" aria-live="polite">
        {listening ? 'Listening...' : ''}
      </p>
    );
  }

  return (
    <p
      className="text-[19px] leading-snug font-medium text-fg"
      aria-live="polite"
      data-testid="transcript"
    >
      {lockedWords.length > 0 && words.length === 0 ? (
        <motion.span
          key={final}
          initial={{ backgroundColor: 'color-mix(in srgb, var(--bk-honey) 38%, transparent)' }}
          animate={{ backgroundColor: 'color-mix(in srgb, var(--bk-honey) 0%, transparent)' }}
          transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
          className="rounded-md px-1 py-0.5"
        >
          {final}
        </motion.span>
      ) : (
        words.map((word, index) => (
          <motion.span
            key={`${index}-${word}`}
            variants={wordVariants}
            custom={0}
            initial="hidden"
            animate="visible"
            className="mr-[0.3em] inline-block"
          >
            {word}
          </motion.span>
        ))
      )}
    </p>
  );
}

import { motion } from 'framer-motion';
import { Chip } from '@renderer/components/Chip';
import { staggerContainer } from '@renderer/motion/variants';
import { useController } from './context';

const SUGGESTIONS = [
  { icon: 'weather', label: "What's the weather?" },
  { icon: 'app', label: 'Open Notepad' },
  { icon: 'circle', label: 'Circle to Search' },
  { icon: 'timer', label: 'Set a 5 min timer' },
] as const;

/** Idle suggestion chips (spec 4.1) - each one runs as if typed. */
export function Suggestions() {
  const controller = useController();
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="flex flex-wrap gap-2 px-4 pt-4 pb-3"
      role="group"
      aria-label="Suggestions"
    >
      {SUGGESTIONS.map((suggestion) => (
        <Chip
          key={suggestion.label}
          icon={suggestion.icon}
          onClick={() => void controller.submit(suggestion.label, 'chip')}
        >
          {suggestion.label}
        </Chip>
      ))}
    </motion.div>
  );
}

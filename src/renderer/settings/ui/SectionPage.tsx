import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { spring, tween } from '@renderer/motion/tokens';
import { sectionMeta, type SettingsPage } from '../lib/nav';

/** Fade + 8px slide for the whole page; groups stagger in underneath. */
const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { ...tween.base, staggerChildren: 0.045, delayChildren: 0.03 },
  },
  exit: { opacity: 0, y: -8, transition: tween.fast },
};

const headerVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: spring.soft },
};

export interface SectionPageProps {
  section: SettingsPage;
  children: ReactNode;
}

/** Page chrome shared by every section: animated entrance, 22px title and a short subtitle. */
export function SectionPage({ section, children }: SectionPageProps) {
  const meta = sectionMeta(section);
  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex flex-col gap-5"
    >
      <motion.header variants={headerVariants} className="px-1">
        <h1 className="font-display text-[22px] leading-7 font-semibold text-fg">{meta.title}</h1>
        <p className="mt-0.5 text-[13px] leading-5 text-fg-muted">{meta.description}</p>
      </motion.header>
      {children}
    </motion.div>
  );
}

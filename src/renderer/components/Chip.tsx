import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { spring } from '@renderer/motion/tokens';
import { staggerItem } from '@renderer/motion/variants';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon?: IconName;
  children: ReactNode;
}

/** Suggestion pill ("What's the weather?"). Use inside a stagger container. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { icon, children, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      variants={staggerItem}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
      className={`bk-glass-card inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium text-fg transition-colors duration-[var(--bk-dur-fast)] hover:bg-raised-hover ${className}`}
      {...rest}
    >
      {icon ? (
        <span className="text-accent-text">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      {children}
    </motion.button>
  );
});

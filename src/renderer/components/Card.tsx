import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { cardVariants } from '@renderer/motion/variants';
import { Icon, type IconName } from './Icon';

export interface CardProps extends Omit<HTMLMotionProps<'section'>, 'children' | 'title'> {
  /** Stagger index for the entrance animation. */
  index?: number;
  icon?: IconName;
  title?: ReactNode;
  /** Right-aligned header content (e.g. copy / pin buttons). */
  headerActions?: ReactNode;
  /** Lifts slightly on hover. Disable for dense/static content. */
  lift?: boolean;
  children?: ReactNode;
}

/** Glass card: staggered spring entrance, layout animation, hover lift, 1px inner highlight. */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { index = 0, icon, title, headerActions, lift = true, className = '', children, ...rest },
  ref,
) {
  const hasHeader = Boolean(icon ?? title ?? headerActions);
  return (
    <motion.section
      ref={ref}
      layout="position"
      variants={cardVariants}
      custom={index}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={lift ? { y: -2 } : undefined}
      className={`bk-glass-card rounded-card text-fg ${className}`}
      {...rest}
    >
      {hasHeader ? (
        <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-1">
          {icon ? (
            <span className="text-accent-text">
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          {title ? (
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-wide text-fg-muted uppercase">
              {title}
            </h2>
          ) : (
            <span className="flex-1" />
          )}
          {headerActions}
        </header>
      ) : null}
      {children}
    </motion.section>
  );
});

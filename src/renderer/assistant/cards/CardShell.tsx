import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Card } from '@shared/cards';
import { Button, IconButton } from '@renderer/components/Button';
import { Icon, type IconName } from '@renderer/components/Icon';
import { cardVariants } from '@renderer/motion/variants';
import { useController } from '../context';

export interface CardShellProps {
  card: Card;
  index: number;
  icon: IconName;
  title: string;
  /** Extra header controls (rendered before copy/open). */
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shared chrome of every answer card: header with Copy / Open-in-browser (spec 4.1), staggered
 * spring entrance, hover lift, glass surface, and the card's action buttons.
 */
export function CardShell({
  card,
  index,
  icon,
  title,
  headerExtra,
  children,
  className = '',
}: CardShellProps) {
  const controller = useController();
  const actions = card.actions ?? [];

  return (
    <motion.section
      layout="position"
      variants={cardVariants}
      custom={index}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={{ y: -2 }}
      aria-label={title}
      className={`bk-glass-card rounded-card text-fg ${className}`}
      data-card-kind={card.kind}
    >
      <header className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-accent-text">
          <Icon name={icon} size={17} />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-[0.08em] text-fg-muted uppercase">
          {title}
        </h2>
        {headerExtra}
        {card.copyText ? (
          <IconButton
            size="sm"
            icon="copy"
            label="Copy"
            onClick={() => void controller.copyCard(card)}
          />
        ) : null}
        {card.openUrl ? (
          <IconButton
            size="sm"
            icon="external"
            label="Open in browser"
            onClick={() => void controller.openUrl(card.openUrl ?? '')}
          />
        ) : null}
      </header>
      <div className="px-4 pt-1 pb-3.5">{children}</div>
      {actions.length > 0 ? (
        <footer className="flex flex-wrap gap-2 px-4 pb-3.5">
          {actions.map((action) => (
            <Button
              key={`${action.type}-${action.label}`}
              size="sm"
              variant="secondary"
              onClick={() => void controller.runAction(action)}
            >
              {action.label}
            </Button>
          ))}
        </footer>
      ) : null}
    </motion.section>
  );
}

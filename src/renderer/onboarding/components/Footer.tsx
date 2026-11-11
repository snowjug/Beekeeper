import { motion } from 'framer-motion';
import { Button } from '@renderer/components/Button';
import { Icon } from '@renderer/components/Icon';
import { tween } from '@renderer/motion/tokens';
import type { FooterActionId, FooterSpec } from '../footer';
import { Notice } from './Notice';

export interface FooterProps {
  spec: FooterSpec;
  /** Friendly text when finishing failed. */
  error: string | null;
  onAction: (id: FooterActionId) => void;
  onBack: () => void;
}

/** Persistent navigation: Back on the left, the screen's skip and primary action on the right. */
export function Footer({ spec, error, onAction, onBack }: FooterProps) {
  const { primary, skip, canGoBack } = spec;
  return (
    <footer className="absolute inset-x-0 bottom-0 z-20 flex h-[80px] items-center justify-between px-10">
      {error ? (
        <Notice tone="bad" role="alert" className="absolute bottom-full left-1/2 -translate-x-1/2">
          {error}
        </Notice>
      ) : null}
      <div>
        {canGoBack ? (
          <Button variant="ghost" onClick={onBack}>
            <Icon name="chevron-right" size={18} className="rotate-180" />
            Back
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {skip ? (
          <Button variant="ghost" onClick={() => onAction(skip.id)}>
            {skip.label}
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          icon={primary.icon}
          onClick={() => onAction(primary.id)}
        >
          <motion.span
            key={primary.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={tween.fast}
          >
            {primary.label}
          </motion.span>
        </Button>
      </div>
    </footer>
  );
}

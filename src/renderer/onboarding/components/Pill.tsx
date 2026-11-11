import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface PillProps {
  icon?: IconName;
  tone?: PillTone;
  /** "sm" fits inside card headers. */
  size?: 'md' | 'sm';
  children: ReactNode;
  className?: string;
}

const TONES: Record<PillTone, string> = {
  neutral: 'bk-glass-card text-fg',
  good: 'border border-success/30 bg-success/15 text-success',
  warn: 'border border-accent/30 bg-accent/15 text-accent-text',
  bad: 'border border-danger/30 bg-danger/15 text-danger',
};

const SIZES = {
  md: { box: 'gap-2 px-3.5 py-2 text-[13px]', icon: 16 },
  sm: { box: 'gap-1.5 px-2.5 py-1 text-[12px]', icon: 14 },
} as const;

/** Static (non-interactive) pill: feature highlights, "try this" examples, status labels. */
export function Pill({ icon, tone = 'neutral', size = 'md', children, className = '' }: PillProps) {
  const { box, icon: iconSize } = SIZES[size];
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${box} ${TONES[tone]} ${className}`}
    >
      {icon ? (
        <span className={tone === 'neutral' ? 'text-accent-text' : undefined}>
          <Icon name={icon} size={iconSize} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

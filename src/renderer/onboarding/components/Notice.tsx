import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';

export type NoticeTone = 'info' | 'good' | 'warn' | 'bad';

export interface NoticeProps {
  tone?: NoticeTone;
  /** "alert" interrupts screen readers (errors); "status" is polite; omit for static hints. */
  role?: 'alert' | 'status';
  /** Tighter padding and type for hints inside dense cards. */
  compact?: boolean;
  children: ReactNode;
  className?: string;
}

const TONES: Record<NoticeTone, { box: string; icon: IconName }> = {
  info: { box: 'bg-sunken text-fg-muted', icon: 'info' },
  good: { box: 'bg-success/12 text-success', icon: 'check' },
  warn: { box: 'bg-accent/15 text-accent-text', icon: 'warning' },
  bad: { box: 'bg-danger/12 text-danger', icon: 'error' },
};

/** Inline message with an icon: hints, status and friendly error texts. */
export function Notice({
  tone = 'info',
  role,
  compact = false,
  children,
  className = '',
}: NoticeProps) {
  const { box, icon } = TONES[tone];
  return (
    <div
      role={role}
      className={`flex items-start gap-2 rounded-control text-left leading-snug ${
        compact ? 'px-2.5 py-1.5 text-[12.5px]' : 'px-3 py-2 text-[13px]'
      } ${box} ${className}`}
    >
      <span className="mt-px shrink-0">
        <Icon name={icon} size={compact ? 14 : 16} />
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

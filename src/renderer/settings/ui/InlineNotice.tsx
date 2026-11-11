import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<NoticeTone, { text: string; icon: IconName }> = {
  info: { text: 'text-accent-text', icon: 'info' },
  success: { text: 'text-success', icon: 'check' },
  warning: { text: 'text-accent-text', icon: 'warning' },
  danger: { text: 'text-danger', icon: 'error' },
};

export interface InlineNoticeProps {
  tone?: NoticeTone;
  icon?: IconName;
  children: ReactNode;
  /** Button or link shown at the end of the notice. */
  action?: ReactNode;
  /** Announce to assistive tech when it appears (results of a user action). */
  live?: boolean;
}

/** Compact callout for hints, results and problems. Danger notices are always announced. */
export function InlineNotice({
  tone = 'info',
  icon,
  children,
  action,
  live = false,
}: InlineNoticeProps) {
  const style = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : live ? 'status' : undefined}
      className="flex items-start gap-3 rounded-control border border-line bg-sunken px-3.5 py-2.5 text-[13px] leading-5 text-fg"
    >
      <span className={`mt-0.5 shrink-0 ${style.text}`}>
        <Icon name={icon ?? style.icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

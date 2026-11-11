import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';
import { spring } from '@renderer/motion/tokens';
import type { ActionStatus } from './store';

const STATUS_ICON: Partial<Record<ActionStatus, IconName>> = {
  busy: 'refresh',
  done: 'check',
  error: 'error',
};

const STATUS_COLOR: Partial<Record<ActionStatus, string>> = {
  done: 'text-success',
  error: 'text-danger',
};

export interface ToolButtonProps {
  icon: IconName;
  /** Accessible name; also the tooltip. */
  label: string;
  /** Keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  status?: ActionStatus;
  disabled?: boolean;
  /** The button is a toggle that is currently on. */
  pressed?: boolean;
  /** The button opens a menu. */
  menu?: { open: boolean };
  /** Where the tooltip appears. Default: below the button. */
  tipSide?: 'top' | 'bottom';
  size?: 'md' | 'lg';
  testId?: string;
  onClick: () => void;
}

/** A round icon button with a tooltip and a busy / done / error state that swaps its icon. */
export function ToolButton({
  icon,
  label,
  shortcut,
  status = 'idle',
  disabled = false,
  pressed,
  menu,
  tipSide = 'bottom',
  size = 'lg',
  testId,
  onClick,
}: ToolButtonProps) {
  const busy = status === 'busy';
  const shown = STATUS_ICON[status] ?? icon;
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu ? menu.open : undefined}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      data-tip-side={tipSide}
      data-status={status}
      data-testid={testId}
      disabled={disabled || busy}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      onClick={onClick}
      className={`bk-tip grid shrink-0 place-items-center rounded-full text-fg transition-colors duration-[var(--bk-dur-fast)] hover:bg-raised-hover disabled:opacity-60 ${
        pressed ? 'bg-raised-hover text-accent-text' : ''
      } ${size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'}`}
    >
      <span className={`${STATUS_COLOR[status] ?? ''} ${busy ? 'animate-spin' : ''}`}>
        <Icon name={shown} size={size === 'lg' ? 22 : 19} />
      </span>
    </motion.button>
  );
}

export interface PillProps {
  icon?: IconName;
  children: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  menu?: { open: boolean };
  testId?: string;
  onClick: () => void;
}

/** A rounded label button over the dimmed screen ("Photo assist", "Set as wallpaper"). */
export function Pill({ icon, children, disabled, busy, menu, testId, onClick }: PillProps) {
  return (
    <motion.button
      type="button"
      aria-busy={busy || undefined}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu ? menu.open : undefined}
      data-testid={testId}
      disabled={disabled || busy}
      whileTap={{ scale: 0.96 }}
      transition={spring.snappy}
      onClick={onClick}
      className="bk-glass inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-fg transition-colors duration-[var(--bk-dur-fast)] hover:bg-raised-hover disabled:opacity-60"
    >
      {icon ? (
        <span className={`text-accent-text ${busy ? 'animate-spin' : ''}`}>
          <Icon name={busy ? 'refresh' : icon} size={18} />
        </span>
      ) : null}
      {children}
    </motion.button>
  );
}

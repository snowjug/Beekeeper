import type { ReactNode } from 'react';
import { Icon, type IconName } from '@renderer/components/Icon';

export interface LinkButtonProps {
  children: ReactNode;
  onClick: () => void;
  icon?: IconName;
  disabled?: boolean;
}

/** Text-only button styled as an in-line link ("Open AI settings", "Open on GitHub"). */
export function LinkButton({ children, onClick, icon, disabled = false }: LinkButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-accent-text underline-offset-2 hover:underline disabled:opacity-50"
    >
      {children}
      {icon ? <Icon name={icon} size={14} /> : null}
    </button>
  );
}

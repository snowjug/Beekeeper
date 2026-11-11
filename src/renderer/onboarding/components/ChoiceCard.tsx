import { useId, type ReactNode } from 'react';
import { Icon } from '@renderer/components/Icon';

export interface ChoiceCardProps {
  /** Same for every card of one group, so the native radios act as one group. */
  group: string;
  value: string;
  /** Large title; it is also the accessible name of the radio. */
  title: ReactNode;
  description?: ReactNode;
  /** A last, quieter line (size of the download, ...). */
  meta?: ReactNode;
  /** Small pill next to the title ("Recommended"). */
  badge?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A big selectable card. The radio itself is visually hidden but stays a real, focusable radio:
 * arrow keys move between cards, Space selects, and screen readers announce "1 of 3".
 */
export function ChoiceCard({
  group,
  value,
  title,
  description,
  meta,
  badge,
  checked,
  disabled = false,
  onSelect,
}: ChoiceCardProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <label
      className={`relative flex min-w-0 flex-col gap-0.5 rounded-card border px-3.5 py-2.5 text-left transition-colors duration-[var(--bk-dur-fast)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--bk-focus)] ${
        checked ? 'border-accent bg-accent/10' : 'border-line bg-raised hover:bg-raised-hover'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <input
        type="radio"
        name={group}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="flex items-center gap-2">
        <span id={titleId} className="text-[16px] leading-6 font-semibold text-fg">
          {title}
        </span>
        {badge}
        {checked ? (
          <span aria-hidden className="ml-auto text-accent-text">
            <Icon name="check" size={18} />
          </span>
        ) : null}
      </span>
      {description ? (
        <span id={descriptionId} className="text-[13px] leading-snug text-fg-muted">
          {description}
        </span>
      ) : null}
      {meta ? <span className="text-[12.5px] leading-snug text-fg-faint">{meta}</span> : null}
    </label>
  );
}

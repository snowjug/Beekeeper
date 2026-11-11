import { useId, type ReactNode } from 'react';

export interface ChoiceControl {
  /** Same for every row of one group, so the native radios act as one group. */
  group: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ChoiceRowProps {
  title: string;
  description?: ReactNode;
  /** Makes the row one option of a radio group; omit it for a plain row with the same layout. */
  choice?: ChoiceControl;
  /** Small label next to the title ("Recommended"). */
  badge?: ReactNode;
  /** Status pill next to the title. */
  status?: ReactNode;
  /** Buttons on the right. They stay outside the radio's label, so they never change the choice. */
  actions?: ReactNode;
  /** Full-width content under the text (progress, notices). */
  children?: ReactNode;
  /** Spoken (never shown) through a polite live region, e.g. a download milestone. */
  announcement?: string;
}

/**
 * One option in a list of choices that carry their own state and buttons (a download card).
 * A native radio gives arrow-key navigation and screen-reader semantics for free; the whole text
 * block is its label, so a click anywhere on it selects the row.
 */
export function ChoiceRow({
  title,
  description,
  choice,
  badge,
  status,
  actions,
  children,
  announcement,
}: ChoiceRowProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const selected = choice?.selected === true;

  const text = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={titleId} className="text-[14px] leading-5 font-medium text-fg">
          {title}
        </span>
        {badge}
        {status}
      </span>
      {description ? (
        <span
          id={descriptionId}
          className="mt-0.5 block text-[12.5px] leading-[18px] text-fg-muted"
        >
          {description}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={`px-4 py-3.5 transition-colors duration-[var(--bk-dur-fast)] ${
        selected ? 'bg-accent/10' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {choice ? (
          <input
            id={inputId}
            type="radio"
            name={choice.group}
            value={choice.value}
            checked={choice.selected}
            disabled={choice.disabled}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            onChange={choice.onSelect}
            className="mt-[3px] size-4 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
          />
        ) : null}
        {choice ? (
          <label
            htmlFor={inputId}
            className={`min-w-0 flex-1 ${choice.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {text}
          </label>
        ) : (
          <div className="min-w-0 flex-1">{text}</div>
        )}
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? <div className={`mt-2.5 ${choice ? 'pl-7' : ''}`}>{children}</div> : null}
      {announcement !== undefined ? (
        <span role="status" className="sr-only">
          {announcement}
        </span>
      ) : null}
    </div>
  );
}

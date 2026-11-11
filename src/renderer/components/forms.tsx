import { motion, type Variants } from 'framer-motion';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { BRAND_COLORS } from '@shared/constants';
import { clamp, hexToRgb, rgbToCss, samplePalette, smoothTowards } from '@renderer/motion/math';
import { spring } from '@renderer/motion/tokens';
import { useAnimationLoop } from '@renderer/motion/useAnimationLoop';
import { Icon, type IconName } from './Icon';
import { Toggle } from './Toggle';

/* ---------------------------------------------------------------- groups & rows */

const groupVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: spring.soft },
};

export interface SettingsGroupProps {
  title?: string;
  /** Short explanation under the card. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled glass card whose rows are separated by 1px dividers. Staggers in with its parent. */
export function SettingsGroup({ title, footer, children, className = '' }: SettingsGroupProps) {
  const titleId = useId();
  return (
    <motion.div
      role="group"
      aria-labelledby={title ? titleId : undefined}
      variants={groupVariants}
      className={className}
    >
      {title ? (
        <h2
          id={titleId}
          className="mb-2 px-1 text-[12px] font-semibold tracking-wide text-fg-muted uppercase"
        >
          {title}
        </h2>
      ) : null}
      <div className="bk-glass-card divide-y divide-line rounded-card">{children}</div>
      {footer ? (
        <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-muted">{footer}</p>
      ) : null}
    </motion.div>
  );
}

const RowContext = createContext<string | undefined>(undefined);

/** Id of the surrounding row's description, so form controls can announce it. */
export function useRowDescription(): string | undefined {
  return useContext(RowContext);
}

export interface SettingRowProps {
  label: string;
  description?: ReactNode;
  /** Pill or small status shown next to the label. */
  status?: ReactNode;
  /** Controls under the text, full width (long inputs). */
  stacked?: boolean;
  /** Extra content under the row (notices, meters, errors). */
  below?: ReactNode;
  /** The control, right-aligned. */
  children?: ReactNode;
}

/** ~56px row: label + description on the left, control on the right. */
export function SettingRow({
  label,
  description,
  status,
  stacked = false,
  below,
  children,
}: SettingRowProps) {
  const descriptionId = useId();
  return (
    <RowContext.Provider value={description ? descriptionId : undefined}>
      <div className="flex min-h-14 flex-col justify-center px-4 py-2.5">
        <div className={`flex gap-x-4 gap-y-2.5 ${stacked ? 'flex-col' : 'items-center'}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14px] leading-5 font-medium text-fg">{label}</span>
              {status}
            </div>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          {children ? <div className={stacked ? 'w-full' : 'shrink-0'}>{children}</div> : null}
        </div>
        {below ? <div className="mt-2.5">{below}</div> : null}
      </div>
    </RowContext.Provider>
  );
}

export interface ToggleRowProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  status?: ReactNode;
  below?: ReactNode;
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  status,
  below,
}: ToggleRowProps) {
  return (
    <SettingRow label={label} description={description} status={status} below={below}>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </SettingRow>
  );
}

/* ---------------------------------------------------------------- choices */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}

function arrowStep(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

/** Radio group drawn as a segmented control; the selection thumb glides between options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
}: SegmentedProps<T>) {
  const thumbId = useId();
  const describedBy = useRowDescription();
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const tabbable = options.some((option) => option.value === value) ? value : options[0]?.value;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = arrowStep(event.key);
    if (step === 0) return;
    event.preventDefault();
    const count = options.length;
    for (let offset = 1; offset <= count; offset += 1) {
      const candidate = options[(((index + step * offset) % count) + count) % count];
      if (candidate && !candidate.disabled) {
        buttons.current.get(candidate.value)?.focus();
        onChange(candidate.value);
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      className="inline-flex rounded-control border border-line bg-sunken p-0.5"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) buttons.current.set(option.value, node);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={option.value === tabbable ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={`relative inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium transition-colors duration-[var(--bk-dur-fast)] disabled:opacity-50 ${
              selected ? 'text-accent-contrast' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {selected ? (
              <motion.span
                aria-hidden
                layoutId={`segmented-thumb-${thumbId}`}
                transition={spring.snappy}
                className="absolute inset-0 rounded-[10px] bg-accent shadow-soft"
              />
            ) : null}
            {option.icon ? (
              <span className="relative">
                <Icon name={option.icon} size={15} />
              </span>
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  /** Looks disabled but stays focusable and readable (a single fixed choice). */
  readOnly?: boolean;
  fullWidth?: boolean;
}

/** Native select (full keyboard and screen reader support) with the design-system look. */
export function SelectField({
  value,
  options,
  onChange,
  label,
  disabled = false,
  readOnly = false,
  fullWidth = false,
}: SelectFieldProps) {
  const describedBy = useRowDescription();
  return (
    <div className={`relative ${fullWidth ? 'w-full' : 'w-[240px]'}`}>
      <select
        aria-label={label}
        aria-describedby={describedBy}
        aria-disabled={readOnly || undefined}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          if (!readOnly) onChange(event.target.value);
        }}
        className={`h-9 w-full appearance-none truncate rounded-control border border-line bg-sunken pr-9 pl-3 text-[14px] text-fg *:bg-surface-solid *:text-fg disabled:opacity-50 ${
          readOnly ? 'cursor-default text-fg-muted' : 'cursor-pointer'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-fg-muted">
        <Icon name="chevron-down" size={16} />
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- feedback */

const METER_SEGMENTS = 28;
const METER_UNLIT = 0.14;

const METER_COLORS: readonly string[] = (() => {
  const stops = [
    BRAND_COLORS.honey,
    BRAND_COLORS.coral,
    BRAND_COLORS.violet,
    BRAND_COLORS.cyan,
  ].map(hexToRgb);
  return Array.from({ length: METER_SEGMENTS }, (_, index) =>
    rgbToCss(samplePalette(stops, (index / (METER_SEGMENTS - 1)) * (stops.length - 1))),
  );
})();

export interface LevelMeterProps {
  /** Smoothed microphone level 0..1, written by whoever owns the microphone. */
  levelRef: MutableRefObject<number>;
  active: boolean;
  label: string;
  className?: string;
}

/**
 * Segmented level meter in the brand colours. Segments are updated straight on the DOM from an
 * animation-frame loop (no React renders at 60 fps) and the loop only runs while `active`.
 */
export function LevelMeter({ levelRef, active, label, className = '' }: LevelMeterProps) {
  const cells = useRef<Array<HTMLSpanElement | null>>([]);
  const opacities = useRef<number[]>(Array.from({ length: METER_SEGMENTS }, () => METER_UNLIT));
  const shown = useRef(0);

  const paint = useCallback((level: number): void => {
    for (let index = 0; index < METER_SEGMENTS; index += 1) {
      const lit = clamp(level * METER_SEGMENTS - index, 0, 1);
      const next = Math.round((METER_UNLIT + (1 - METER_UNLIT) * lit) * 50) / 50;
      if (opacities.current[index] === next) continue;
      opacities.current[index] = next;
      const cell = cells.current[index];
      if (cell) cell.style.opacity = String(next);
    }
  }, []);

  useAnimationLoop((dt) => {
    shown.current = smoothTowards(shown.current, clamp(levelRef.current, 0, 1), dt, 0.03, 0.16);
    paint(shown.current);
  }, active);

  useEffect(() => {
    if (active) return;
    shown.current = 0;
    paint(0);
  }, [active, paint]);

  return (
    <div role="img" aria-label={label} className={`flex h-3 items-stretch gap-[3px] ${className}`}>
      {METER_COLORS.map((color, index) => (
        <span
          key={color}
          ref={(node) => {
            cells.current[index] = node;
          }}
          className="flex-1 rounded-[3px]"
          style={{ background: color, opacity: METER_UNLIT }}
        />
      ))}
    </div>
  );
}

export type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const PILL_TONES: Record<PillTone, { text: string; icon: IconName | null }> = {
  neutral: { text: 'text-fg-muted', icon: null },
  info: { text: 'text-fg', icon: 'info' },
  success: { text: 'text-success', icon: 'check' },
  warning: { text: 'text-accent-text', icon: 'warning' },
  danger: { text: 'text-danger', icon: 'error' },
};

export interface StatusPillProps {
  tone?: PillTone;
  /** Overrides the tone's icon; `null` hides it. Colour is never the only signal. */
  icon?: IconName | null;
  children: ReactNode;
}

export function StatusPill({ tone = 'neutral', icon, children }: StatusPillProps) {
  const style = PILL_TONES[tone];
  const iconName = icon === undefined ? style.icon : icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] leading-4 font-semibold ring-1 ring-current/25 ring-inset ${style.text}`}
    >
      {iconName ? <Icon name={iconName} size={12} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}

/** One keyboard key cap; `ghost` draws the dashed placeholder for a key still to be pressed. */
export function Kbd({ children, ghost = false }: { children: ReactNode; ghost?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-[8px] border px-2 font-sans text-[12px] font-semibold ${
        ghost
          ? 'border-dashed border-line text-fg-faint'
          : 'border-b-2 border-line bg-raised text-fg shadow-soft'
      }`}
    >
      {children}
    </kbd>
  );
}

export interface KeyComboProps {
  /** Friendly accelerator such as "Ctrl+Shift+Space". */
  accelerator?: string;
  /** Explicit key names; used instead of `accelerator` when given. */
  keys?: readonly string[];
  /** Adds a dashed placeholder cap while a shortcut is still being recorded. */
  pending?: boolean;
}

export function KeyCombo({ accelerator = '', keys, pending = false }: KeyComboProps) {
  const parts = keys ?? accelerator.split('+').filter((part) => part !== '');
  const total = parts.length + (pending ? 1 : 0);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {Array.from({ length: total }, (_, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span aria-hidden className="text-[11px] text-fg-faint">
              +
            </span>
          ) : null}
          {index < parts.length ? <Kbd>{parts[index]}</Kbd> : <Kbd ghost>...</Kbd>}
        </Fragment>
      ))}
    </span>
  );
}

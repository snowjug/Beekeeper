import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { spring } from '@renderer/motion/tokens';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast shadow-soft hover:brightness-105 active:brightness-95 font-semibold',
  secondary: 'bg-raised text-fg border border-line hover:bg-raised-hover font-medium',
  ghost: 'text-fg-muted hover:text-fg hover:bg-raised font-medium',
  danger: 'bg-danger text-danger-contrast shadow-soft hover:brightness-105 font-semibold',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2.5',
};

/** Pressable control: scales to 0.97 on press with a snappy spring. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 22 : 18;
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
      className={`inline-flex shrink-0 items-center justify-center rounded-control whitespace-nowrap transition-colors duration-[var(--bk-dur-fast)] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </motion.button>
  );
});

export interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: IconName;
  /** Required accessible name (also used as tooltip). */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

const ICON_BUTTON_SIZES = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active = false, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--bk-dur-fast)] disabled:pointer-events-none disabled:opacity-50 ${
        active ? 'bg-raised-hover text-accent-text' : 'text-fg-muted hover:bg-raised hover:text-fg'
      } ${ICON_BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 22 : 18} />
    </motion.button>
  );
});

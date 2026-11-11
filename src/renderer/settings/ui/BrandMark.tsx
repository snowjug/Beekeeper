import { useId } from 'react';
import { BRAND_COLORS } from '@shared/constants';

export interface BrandMarkProps {
  size?: number;
  /** Accessible name; the mark is decorative when omitted. */
  title?: string;
}

/** Honeycomb hexagon with the four brand dots (an inline, theme-independent version of the app icon). */
export function BrandMark({ size = 24, title }: BrandMarkProps) {
  const id = useId().replace(/:/g, '');
  const rim = `${id}-rim`;
  const glass = `${id}-glass`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={rim} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF3C4" />
          <stop offset="0.28" stopColor="#FFD455" />
          <stop offset="0.6" stopColor={BRAND_COLORS.honey} />
          <stop offset="1" stopColor="#FF6B4A" />
        </linearGradient>
        <radialGradient id={glass} cx="32" cy="24" r="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#352A63" />
          <stop offset="0.55" stopColor="#1C1539" />
          <stop offset="1" stopColor="#0C0919" />
        </radialGradient>
      </defs>
      <path
        d="M32 5 55.4 18.5v27L32 59 8.6 45.5v-27z"
        fill={`url(#${glass})`}
        stroke={`url(#${rim})`}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="25" cy="26" r="4.8" fill={BRAND_COLORS.honey} />
      <circle cx="39" cy="26" r="4.8" fill={BRAND_COLORS.coral} />
      <circle cx="25" cy="40" r="4.8" fill={BRAND_COLORS.violet} />
      <circle cx="39" cy="40" r="4.8" fill={BRAND_COLORS.cyan} />
    </svg>
  );
}

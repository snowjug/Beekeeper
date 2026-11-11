import { useId } from 'react';
import { BRAND_COLORS } from '@shared/constants';

export interface BrandMarkProps {
  size?: number;
  /** Accessible name; the mark is decorative when omitted. */
  title?: string;
}

const INK = '#2A1650';

/** Arc of a circle around the bee's head (local bee space, facing right). */
function waveArc(radius: number): string {
  const head = { x: 68, y: -4 };
  const point = (degrees: number): string => {
    const angle = (degrees * Math.PI) / 180;
    return `${(head.x + radius * Math.cos(angle)).toFixed(1)} ${(head.y + radius * Math.sin(angle)).toFixed(1)}`;
  };
  return `M${point(-40)}A${radius} ${radius} 0 0 1 ${point(40)}`;
}

/** Honeycomb hexagon with the Beekeeper bee (an inline, theme-independent version of the app icon). */
export function BrandMark({ size = 24, title }: BrandMarkProps) {
  const id = useId().replace(/:/g, '');
  const rim = `${id}-rim`;
  const glass = `${id}-glass`;
  const body = `${id}-body`;
  const wing = `${id}-wing`;
  const abdomen = `${id}-abdomen`;
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
        <linearGradient id={body} x1="0" y1="-48" x2="0" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFECAA" />
          <stop offset="0.42" stopColor="#FFC929" />
          <stop offset="1" stopColor="#E88700" />
        </linearGradient>
        <linearGradient
          id={wing}
          x1="-20"
          y1="-140"
          x2="12"
          y2="-30"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#A5F3FF" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#7FB5FF" stopOpacity="0.74" />
          <stop offset="1" stopColor="#9B72FF" stopOpacity="0.58" />
        </linearGradient>
        <clipPath id={abdomen}>
          <ellipse cx="-58" cy="8" rx="64" ry="46" />
        </clipPath>
      </defs>
      <path
        d="M32 5 55.4 18.5v27L32 59 8.6 45.5v-27z"
        fill={`url(#${glass})`}
        stroke={`url(#${rim})`}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <g transform="translate(31.5 36.6) rotate(-15) scale(.12)">
        <ellipse
          cx="8"
          cy="-66"
          rx="30"
          ry="60"
          transform="rotate(-16 8 -66)"
          fill={`url(#${wing})`}
          stroke="#fff"
          strokeOpacity="0.5"
          strokeWidth="3"
        />
        <path d="M-116 4L-140 14L-116 26Z" fill={INK} />
        <ellipse cx="-58" cy="8" rx="64" ry="46" fill={`url(#${body})`} />
        <g clipPath={`url(#${abdomen})`}>
          <path d="M-96-52Q-86 8-96 68L-76 68Q-66 8-76-52Z" fill={INK} />
          <path d="M-60-52Q-50 8-60 68L-40 68Q-30 8-40-52Z" fill={INK} />
        </g>
        <ellipse cx="14" cy="2" rx="38" ry="40" fill={`url(#${body})`} />
        <circle cx="68" cy="-4" r="30" fill={`url(#${body})`} />
        <ellipse cx="78" cy="-10" rx="10" ry="12" fill={INK} />
        <circle cx="81" cy="-14.5" r="3.6" fill="#fff" />
        <path d={waveArc(60)} fill="none" stroke="#5FE3F0" strokeWidth="15" strokeLinecap="round" />
        <path
          d={waveArc(92)}
          fill="none"
          stroke="#A98BFF"
          strokeWidth="15"
          strokeLinecap="round"
          opacity="0.9"
        />
      </g>
    </svg>
  );
}

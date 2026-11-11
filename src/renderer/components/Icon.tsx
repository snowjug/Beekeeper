import type { SVGProps } from 'react';
import type { CardIcon } from '@shared/cards';

export type UiIcon =
  | 'close'
  | 'send'
  | 'history'
  | 'pin'
  | 'pin-filled'
  | 'external'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-right'
  | 'plus'
  | 'minus'
  | 'play'
  | 'refresh'
  | 'download'
  | 'translate'
  | 'image'
  | 'keyboard'
  | 'shield'
  | 'globe'
  | 'sliders'
  | 'user'
  | 'trash-can'
  | 'edit'
  | 'link'
  | 'mail'
  | 'phone'
  | 'speaker'
  | 'sun'
  | 'info-circle'
  | 'cloud'
  | 'drop'
  | 'wind'
  | 'snow'
  | 'bolt'
  | 'fog'
  | 'more'
  | 'share'
  | 'undo'
  | 'redo'
  | 'crop'
  | 'pen'
  | 'highlighter'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'pixelate'
  | 'eraser'
  | 'folder'
  | 'contrast'
  | 'pointer';

export type IconName = CardIcon | UiIcon;

const PATHS: Record<IconName, JSX.Element> = {
  app: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="4" />
      <path d="m10.5 9.5 4 2.5-4 2.5z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  weather: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 3v1.5M3 9h1.5M4.8 4.8l1 1M13.2 4.8l-1 1" />
      <path d="M7.5 19.5h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2 3 3 0 0 0 .2 5.8z" />
    </>
  ),
  battery: (
    <>
      <rect x="3" y="8" width="16" height="9" rx="2.5" />
      <path d="M21 11v3M7 11.5V14M11 11.5V14" />
    </>
  ),
  cpu: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <path d="M8.5 7.5h7M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" />
    </>
  ),
  convert: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  book: (
    <>
      <path d="M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2z" />
      <path d="M5 20a2 2 0 0 0 2 2h12" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4l2.5 1.5M9.5 2.5h5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9.5V13l2.5 1.5M4 5.5 7 3M20 5.5 17 3" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h7M9 16h5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="3" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  volume: (
    <>
      <path d="M4 10v4h3.5L12 18V6l-4.5 4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 10v4h3.5L12 18V6l-4.5 4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  brightness: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  screenshot: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="3" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5.5M13.5 11v5.5" />,
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M7 6.2a8 8 0 1 0 10 0" />
    </>
  ),
  restart: <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5" />,
  sleep: <path d="M4 5h6L4 12h6M13 11h4.5L13 17h4.5" />,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  circle: (
    <>
      <circle cx="11" cy="11" r="7.5" strokeDasharray="3.2 2.6" />
      <circle cx="11" cy="11" r="2.2" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M18.5 16v4M16.5 18h4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="3" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  warning: (
    <>
      <path d="M12 4 3 19.5h18z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  wifi: (
    <>
      <path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a8 8 0 0 1 11 0M9.4 16a4 4 0 0 1 5.2 0" />
      <path d="M12 19.5h.01" />
    </>
  ),
  bluetooth: <path d="m7 7 10 10-5 4V3l5 4L7 17" />,
  display: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  sound: (
    <>
      <path d="M4 10v4h3.5L12 18V6l-4.5 4z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5" />
      <path d="M12 8v4l2.5 1.5" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3z" />
      <path d="M12 13.5V20" />
    </>
  ),
  'pin-filled': (
    <>
      <path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3z" fill="currentColor" />
      <path d="M12 13.5V20" />
    </>
  ),
  external: (
    <path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  ),
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  play: <path d="M8 5.5v13l11-6.5z" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  translate: (
    <path d="M4 6h9M8.5 4v2M6 6c.5 3.5 3 6 6 7M12 6c-.5 3.5-3 6-7 8M12.5 20l4-9 4 9M13.8 17h5.4" />
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5 17 4.5-4.5 3 3 2-2L20 17" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8" />
    </>
  ),
  shield: <path d="M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  'trash-can': <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />,
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="m4 8 8 5.5L20 8" />
    </>
  ),
  phone: (
    <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 13l4 1.5v3a2.5 2.5 0 0 1-2.5 2.5A14.5 14.5 0 0 1 4 6.5 2.5 2.5 0 0 1 6.5 4z" />
  ),
  speaker: (
    <>
      <path d="M4 10v4h3.5L12 18V6l-4.5 4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  'info-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  cloud: <path d="M7.5 19h9a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7.5 19z" />,
  drop: <path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.700 12 3.500 12 3.500z" />,
  wind: (
    <path d="M3 9h10a2.500 2.500 0 1 0-2.500-2.500M3 14h14a2.500 2.500 0 1 1-2.500 2.500M3 19h6" />
  ),
  snow: <path d="M12 3v18M4.500 7.500l15 9M19.500 7.500l-15 9" />,
  bolt: <path d="m13 3-7 10h5l-1 8 7-10h-5z" />,
  fog: <path d="M4 9h16M6 13h12M4 17h16" />,
  more: (
    <>
      <circle cx="12" cy="5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="m8.2 10.9 7.6-3.8M8.2 13.1l7.6 3.8" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  crop: <path d="M7 3v14a1 1 0 0 0 1 1h13M3 7h14a1 1 0 0 1 1 1v13" />,
  pen: <path d="M3.5 17c2.5-6 4.5-10 6.5-10s1.5 7 4 7 3-4 6.5-4" />,
  highlighter: (
    <>
      <path d="m14 5 5 5-8 8H6v-5z" />
      <path d="M4 21h9" />
    </>
  ),
  arrow: <path d="M5 19 19 5M9 5h10v10" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6" />,
  text: <path d="M5 6V4.5h14V6M12 4.5V20M9 20h6" />,
  pixelate: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" fill="currentColor" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" fill="currentColor" />
    </>
  ),
  eraser: (
    <>
      <path d="m7 20-3.5-3.5a2 2 0 0 1 0-2.8L13 4.2a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11.5 19.5" />
      <path d="M7 20h13M8.5 9.5l6 6" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
    </>
  ),
  pointer: <path d="m5 4 14 6.5-6 2-2 6z" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  size?: number;
  /** Accessible label. Omit for decorative icons (they are hidden from assistive tech). */
  title?: string;
}

export function Icon({ name, size = 20, title, strokeWidth = 1.8, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

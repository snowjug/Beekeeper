import type { WeatherCondition } from '@shared/cards';

export interface WeatherIconProps {
  condition: WeatherCondition;
  isDay?: boolean;
  size?: number;
  /** Static icons are used in the 7-day strip. */
  animated?: boolean;
}

const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;
const CLOUD =
  'M19 47h27a10.5 10.5 0 0 0 1.6-20.9A14.5 14.5 0 0 0 19.800 27.800 9.600 9.600 0 0 0 19 47z';

function Sun({
  animated,
  cx = 32,
  cy = 32,
  scale = 1,
}: {
  animated: boolean;
  cx?: number;
  cy?: number;
  scale?: number;
}) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(-32 -32)`}>
      <g
        className={animated ? 'bk-spin-slow' : undefined}
        stroke="#FFB300"
        strokeWidth="3"
        strokeLinecap="round"
      >
        {RAY_ANGLES.map((angle) => (
          <line key={angle} x1="32" y1="9" x2="32" y2="14" transform={`rotate(${angle} 32 32)`} />
        ))}
      </g>
      <circle cx="32" cy="32" r="10.500" fill="#FFB300" />
      <circle cx="32" cy="32" r="10.500" fill="url(#bk-sun-shine)" />
    </g>
  );
}

function Cloud({
  animated,
  tone = 'light',
  dx = 0,
  dy = 0,
  drift = 'bk-drift',
}: {
  animated: boolean;
  tone?: 'light' | 'dark';
  dx?: number;
  dy?: number;
  drift?: string;
}) {
  return (
    <g transform={`translate(${dx} ${dy})`}>
      <g className={animated ? drift : undefined}>
        <path d={CLOUD} fill={tone === 'dark' ? 'url(#bk-cloud-dark)' : 'url(#bk-cloud)'} />
      </g>
    </g>
  );
}

/** Animated weather glyph drawn with SVG + CSS keyframes (see styles/animations.css). */
export function WeatherIcon({
  condition,
  isDay = true,
  size = 64,
  animated = true,
}: WeatherIconProps) {
  const drops = [0, 1, 2, 3];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      focusable="false"
      className="shrink-0 overflow-visible"
    >
      <defs>
        <linearGradient id="bk-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f7ff" />
          <stop offset="1" stopColor="#b9c6e0" />
        </linearGradient>
        <linearGradient id="bk-cloud-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9aa7c4" />
          <stop offset="1" stopColor="#5c6890" />
        </linearGradient>
        <radialGradient id="bk-sun-shine" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff2c2" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffb300" stopOpacity="0" />
        </radialGradient>
      </defs>

      {condition === 'clear' && isDay ? <Sun animated={animated} /> : null}

      {condition === 'clear' && !isDay ? (
        <g>
          <path d="M40 12a19 19 0 1 0 14 31 15 15 0 0 1-14-31z" fill="#ffd27a" />
          {[
            [14, 16],
            [22, 8],
            [10, 30],
          ].map(([x, y], index) => (
            <circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r="1.600"
              fill="#fff"
              className={animated ? 'bk-twinkle' : undefined}
              style={{ animationDelay: `${index * 0.7}s` }}
            />
          ))}
        </g>
      ) : null}

      {condition === 'partly-cloudy' ? (
        <g>
          {isDay ? (
            <Sun animated={animated} cx={24} cy={22} scale={0.78} />
          ) : (
            <path d="M28 8a14 14 0 1 0 11 22 11 11 0 0 1-11-22z" fill="#ffd27a" />
          )}
          <Cloud animated={animated} dx={3} dy={4} />
        </g>
      ) : null}

      {condition === 'cloudy' ? (
        <g>
          <Cloud animated={animated} tone="dark" dx={-6} dy={-6} drift="bk-drift-alt" />
          <Cloud animated={animated} dx={3} dy={4} />
        </g>
      ) : null}

      {condition === 'fog' ? (
        <g>
          <Cloud animated={animated} dx={0} dy={-6} />
          {[44, 51, 58].map((y, index) => (
            <line
              key={y}
              x1={14 + index * 2}
              y1={y}
              x2={50 - index * 3}
              y2={y}
              stroke="#b9c6e0"
              strokeWidth="3"
              strokeLinecap="round"
              className={animated ? 'bk-fog-line' : undefined}
              style={{ animationDelay: `${index * 0.8}s` }}
            />
          ))}
        </g>
      ) : null}

      {condition === 'drizzle' || condition === 'rain' ? (
        <g>
          <Cloud animated={animated} tone={condition === 'rain' ? 'dark' : 'light'} dy={-6} />
          {(condition === 'rain' ? drops : drops.slice(0, 3)).map((drop) => (
            <line
              key={drop}
              x1={22 + drop * 7}
              y1="46"
              x2={20 + drop * 7}
              y2="52"
              stroke="#4db6ff"
              strokeWidth="2.800"
              strokeLinecap="round"
              className={animated ? 'bk-drop' : undefined}
              style={{ animationDelay: `${drop * 0.27}s` }}
              opacity={animated ? undefined : 0.9}
            />
          ))}
        </g>
      ) : null}

      {condition === 'snow' ? (
        <g>
          <Cloud animated={animated} dy={-6} />
          {drops.map((flake) => (
            <circle
              key={flake}
              cx={22 + flake * 7}
              cy="49"
              r="2.200"
              fill="#fff"
              className={animated ? 'bk-flake' : undefined}
              style={{ animationDelay: `${flake * 0.6}s` }}
              opacity={animated ? undefined : 0.95}
            />
          ))}
        </g>
      ) : null}

      {condition === 'thunderstorm' ? (
        <g>
          <Cloud animated={animated} tone="dark" dy={-8} />
          <path
            d="m33 38-8 12h6l-3 10 11-14h-6l4-8z"
            fill="#ffd54a"
            stroke="#ffb300"
            strokeWidth="1"
            strokeLinejoin="round"
            className={animated ? 'bk-flash' : undefined}
            opacity={animated ? undefined : 1}
          />
        </g>
      ) : null}
    </svg>
  );
}

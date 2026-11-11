import type { WeatherCard } from '@shared/cards';
import { Icon } from '@renderer/components/Icon';
import { formatTemperature } from '@renderer/lib/format';
import { CardShell } from './CardShell';
import { WeatherIcon } from './WeatherIcon';

/** Current conditions (or the asked-about day) plus the 7-day outlook. */
export function WeatherCardView({ card, index }: { card: WeatherCard; index: number }) {
  const { current, days, units } = card;
  const focus = days[card.focusDay];
  const showForecastDay = card.focusDay > 0 && focus !== undefined;
  const degrees = (value: number): string => formatTemperature(value, units);

  return (
    <CardShell card={card} index={index} icon="weather" title={card.place}>
      <div className="flex items-center gap-4">
        <WeatherIcon
          condition={showForecastDay ? focus.condition : current.condition}
          isDay={showForecastDay ? true : current.isDay}
          size={84}
        />
        <div className="min-w-0 flex-1" data-selectable="true">
          {showForecastDay ? (
            <>
              <p className="text-sm font-medium text-fg-muted">{focus.label}</p>
              <p className="font-display text-4xl font-semibold tracking-tight tabular-nums">
                {degrees(focus.tempMax)}
                <span className="ml-2 text-2xl font-normal text-fg-muted">
                  {degrees(focus.tempMin)}
                </span>
              </p>
              <p className="text-[15px]">
                {focus.summary}
                <span className="text-fg-muted"> - {focus.precipChance}% chance of rain</span>
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-5xl font-semibold tracking-tight tabular-nums">
                {degrees(current.temp)}
              </p>
              <p className="text-[15px]">{current.summary}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-fg-muted">
                <span>Feels like {degrees(current.feelsLike)}</span>
                <span className="inline-flex items-center gap-1">
                  <Icon name="drop" size={13} />
                  {Math.round(current.humidity)}%
                </span>
                <span className="inline-flex items-center gap-1">
                  <Icon name="wind" size={13} />
                  {Math.round(current.windSpeed)} {current.windUnit}
                </span>
              </p>
            </>
          )}
        </div>
      </div>

      {card.verdict ? (
        <p className="mt-3 rounded-control bg-accent/12 px-3 py-2 text-[14px] font-medium text-fg">
          {card.verdict}
        </p>
      ) : null}

      <ul className="mt-3 grid grid-cols-7 gap-1" aria-label="7-day forecast">
        {days.slice(0, 7).map((day, dayIndex) => (
          <li
            key={day.date}
            className={`flex flex-col items-center gap-1 rounded-control px-1 py-2 text-center ${
              dayIndex === card.focusDay ? 'bg-raised-hover ring-1 ring-accent/50' : ''
            }`}
          >
            <span className="text-[11px] font-medium text-fg-muted">{day.label}</span>
            <WeatherIcon condition={day.condition} size={30} animated={false} />
            <span className="text-[13px] font-semibold tabular-nums">
              {Math.round(day.tempMax)}&deg;
            </span>
            <span className="text-[12px] text-fg-faint tabular-nums">
              {Math.round(day.tempMin)}&deg;
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

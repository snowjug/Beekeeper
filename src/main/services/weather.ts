import { z } from 'zod';
import type { WeatherCondition, WeatherDay } from '@shared/cards';
import type { Logger } from '@shared/logger';
import { weekdayName } from '../commands/lib/days';
import { getJson, HttpFailure } from '../commands/lib/http';
import { WeatherError } from '../commands/types';
import type { CommandSettings, WeatherQuery, WeatherService } from '../commands/types';
import type { GeolocationService } from './geolocation';

export interface WeatherServiceOptions {
  fetch: typeof fetch;
  geolocation: GeolocationService;
  now: () => Date;
  logger: Logger;
  /** Read on every request so changes in Settings apply immediately. */
  settings: () => CommandSettings['weatherLocation'];
}

type ForecastData = Awaited<ReturnType<WeatherService['forecast']>>;

interface ResolvedPlace {
  latitude: number;
  longitude: number;
  label: string;
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_SIZE = 10;
/** Countries where the state/province is part of how a place is named ("Austin, Texas"). */
const REGION_COUNTRIES = new Set(['US', 'CA', 'AU']);

/** WMO weather interpretation codes as returned by Open-Meteo. */
const WEATHER_CODES: Readonly<Record<number, readonly [WeatherCondition, string]>> = {
  0: ['clear', 'Clear sky'],
  1: ['clear', 'Mainly clear'],
  2: ['partly-cloudy', 'Partly cloudy'],
  3: ['cloudy', 'Overcast'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing fog'],
  51: ['drizzle', 'Light drizzle'],
  53: ['drizzle', 'Drizzle'],
  55: ['drizzle', 'Heavy drizzle'],
  56: ['drizzle', 'Light freezing drizzle'],
  57: ['drizzle', 'Freezing drizzle'],
  61: ['rain', 'Light rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy rain'],
  66: ['rain', 'Light freezing rain'],
  67: ['rain', 'Freezing rain'],
  71: ['snow', 'Light snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy snow'],
  77: ['snow', 'Snow grains'],
  80: ['rain', 'Light rain showers'],
  81: ['rain', 'Rain showers'],
  82: ['rain', 'Heavy rain showers'],
  85: ['snow', 'Light snow showers'],
  86: ['snow', 'Heavy snow showers'],
  95: ['thunderstorm', 'Thunderstorm'],
  96: ['thunderstorm', 'Thunderstorm with hail'],
  99: ['thunderstorm', 'Thunderstorm with heavy hail'],
};

/** Open-Meteo leaves the probability out for some regions; the weather code still says a lot. */
const IMPLIED_PRECIPITATION: Readonly<Record<WeatherCondition, number>> = {
  clear: 0,
  'partly-cloudy': 0,
  cloudy: 0,
  fog: 0,
  drizzle: 40,
  rain: 70,
  snow: 60,
  thunderstorm: 70,
};

const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().nullish(),
        country_code: z.string().nullish(),
        admin1: z.string().nullish(),
      }),
    )
    .optional(),
});

const nullableNumbers = z.array(z.number().nullable());

const forecastSchema = z.object({
  utc_offset_seconds: z.number().optional(),
  timezone: z.string().optional(),
  current: z.object({
    time: z.string().optional(),
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    relative_humidity_2m: z.number(),
    weather_code: z.number(),
    is_day: z.number(),
    wind_speed_10m: z.number(),
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: nullableNumbers,
    temperature_2m_max: nullableNumbers,
    temperature_2m_min: nullableNumbers,
    precipitation_probability_max: nullableNumbers.optional(),
  }),
});

type Forecast = z.infer<typeof forecastSchema>;
type GeocodingResult = NonNullable<z.infer<typeof geocodingSchema>['results']>[number];

function describeCode(code: number): { condition: WeatherCondition; summary: string } {
  const [condition, summary] = WEATHER_CODES[code] ?? ['cloudy', 'Cloudy'];
  return { condition, summary };
}

function placeLabel(result: GeocodingResult): string {
  const parts = [result.name];
  const region = result.admin1 ?? '';
  if (
    region.length > 0 &&
    region !== result.name &&
    REGION_COUNTRIES.has(result.country_code ?? '')
  ) {
    parts.push(region);
  }
  parts.push(result.country ?? result.country_code ?? '');
  return parts.filter((part) => part.length > 0).join(', ');
}

function forecastUrl(place: ResolvedPlace, units: WeatherQuery['units']): string {
  const params = [
    `latitude=${place.latitude.toFixed(4)}`,
    `longitude=${place.longitude.toFixed(4)}`,
    'current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    'timezone=auto',
    'forecast_days=7',
  ];
  if (units === 'imperial') params.push('temperature_unit=fahrenheit', 'wind_speed_unit=mph');
  return `${FORECAST_URL}?${params.join('&')}`;
}

/** Today's calendar date ("YYYY-MM-DD") at the place, derived from the response's zone. */
function localToday(forecast: Forecast, nowMs: number): string | null {
  if (forecast.utc_offset_seconds !== undefined) {
    return new Date(nowMs + forecast.utc_offset_seconds * 1000).toISOString().slice(0, 10);
  }
  if (forecast.timezone !== undefined) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: forecast.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(nowMs));
    } catch {
      // Unknown zone name: fall through to the response's own clock.
    }
  }
  return forecast.current.time?.slice(0, 10) ?? forecast.daily.time[0] ?? null;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string | null): string {
  if (today === null) return weekdayName(date, 'short');
  if (date === today) return 'Today';
  return date === addDays(today, 1) ? 'Tomorrow' : weekdayName(date, 'short');
}

function toForecastData(
  forecast: Forecast,
  place: string,
  units: WeatherQuery['units'],
  nowMs: number,
): ForecastData {
  const today = localToday(forecast, nowMs);
  const { daily, current } = forecast;
  const days: WeatherDay[] = [];
  daily.time.forEach((date, index) => {
    const code = daily.weather_code[index];
    const high = daily.temperature_2m_max[index];
    const low = daily.temperature_2m_min[index];
    if (typeof code !== 'number' || typeof high !== 'number' || typeof low !== 'number') return;
    const { condition, summary } = describeCode(code);
    const probability = daily.precipitation_probability_max?.[index];
    days.push({
      date,
      label: dayLabel(date, today),
      condition,
      summary,
      tempMax: Math.round(high),
      tempMin: Math.round(low),
      precipChance:
        typeof probability === 'number'
          ? Math.min(100, Math.max(0, Math.round(probability)))
          : IMPLIED_PRECIPITATION[condition],
    });
  });
  if (days.length === 0) {
    throw new WeatherError('bad-response', 'The forecast did not contain any days');
  }

  const now = describeCode(current.weather_code);
  const result: ForecastData = {
    kind: 'weather',
    place,
    units,
    current: {
      temp: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      condition: now.condition,
      summary: now.summary,
      isDay: current.is_day === 1,
      humidity: Math.round(current.relative_humidity_2m),
      windSpeed: Math.round(current.wind_speed_10m),
      windUnit: units === 'imperial' ? 'mph' : 'km/h',
    },
    days,
  };
  return result;
}

/**
 * Open-Meteo forecasts (no API key): the place is geocoded by name, the default place comes
 * from Settings (manual city) or from IP geolocation, and identical requests are cached for
 * ten minutes. Failures surface as WeatherError so the command can word them kindly.
 */
export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const { logger } = options;
  const cache = new Map<string, { at: number; value: ForecastData }>();

  async function request(url: string): Promise<unknown> {
    try {
      return await getJson(options.fetch, url, TIMEOUT_MS);
    } catch (error) {
      if (!(error instanceof HttpFailure)) throw error;
      logger.warn('Weather request failed:', error.reason, error.status ?? '');
      if (error.reason === 'network' || error.reason === 'timeout') {
        throw new WeatherError('no-network', 'Could not reach the weather service');
      }
      throw new WeatherError('bad-response', 'The weather service returned an unexpected response');
    }
  }

  async function geocode(name: string): Promise<ResolvedPlace> {
    const query = name.trim();
    if (query.length < 2) throw new WeatherError('not-found', `No place found for "${query}"`);
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const parsed = geocodingSchema.safeParse(await request(url));
    if (!parsed.success) {
      throw new WeatherError(
        'bad-response',
        'The geocoding service returned an unexpected response',
      );
    }
    const first = parsed.data.results?.[0];
    if (!first) throw new WeatherError('not-found', `No place found for "${query}"`);
    return { latitude: first.latitude, longitude: first.longitude, label: placeLabel(first) };
  }

  async function defaultPlace(): Promise<ResolvedPlace> {
    const { mode, city } = options.settings();
    const manualCity = city.trim();
    if (mode === 'manual' && manualCity.length > 0) return geocode(manualCity);
    try {
      return await options.geolocation.locate();
    } catch (error) {
      if (manualCity.length > 0 && error instanceof WeatherError && error.code === 'no-location') {
        return geocode(manualCity);
      }
      throw error;
    }
  }

  return {
    async forecast(query) {
      const requested = query.place?.trim() ?? '';
      const { mode, city } = options.settings();
      const key =
        requested.length > 0
          ? `${query.units}|place:${requested.toLowerCase()}`
          : `${query.units}|default:${mode}:${city.trim().toLowerCase()}`;
      const nowMs = options.now().getTime();

      const hit = cache.get(key);
      cache.delete(key);
      if (hit && nowMs - hit.at < CACHE_TTL_MS) {
        cache.set(key, hit);
        return structuredClone(hit.value);
      }

      const place = requested.length > 0 ? await geocode(requested) : await defaultPlace();
      const parsed = forecastSchema.safeParse(await request(forecastUrl(place, query.units)));
      if (!parsed.success) {
        throw new WeatherError('bad-response', 'The forecast response had an unexpected shape');
      }
      const value = toForecastData(parsed.data, place.label, query.units, nowMs);

      cache.set(key, { at: nowMs, value });
      while (cache.size > CACHE_SIZE) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return structuredClone(value);
    },
  };
}

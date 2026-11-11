import type { Logger } from '@shared/logger';
import { getJson } from '../commands/lib/http';
import { WeatherError } from '../commands/types';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  /** "City, Country" */
  label: string;
}

export interface GeolocationService {
  /** Approximate location of this PC (from its IP address). Throws WeatherError('no-location'). */
  locate(): Promise<GeoLocation>;
}

export interface GeolocationOptions {
  fetch: typeof fetch;
  now: () => Date;
  logger: Logger;
}

const PROVIDER_TIMEOUT_MS = 3000;
const CACHE_MS = 6 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Providers disagree on numbers vs. strings for coordinates. */
function readCoordinate(value: unknown, limit: number): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function toLocation(
  city: unknown,
  region: unknown,
  country: unknown,
  latitudeValue: unknown,
  longitudeValue: unknown,
): GeoLocation | null {
  const latitude = readCoordinate(latitudeValue, 90);
  const longitude = readCoordinate(longitudeValue, 180);
  // 0,0 is what providers return when they have no idea.
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) return null;
  const label = [readText(city) || readText(region), readText(country)]
    .filter((part) => part.length > 0)
    .join(', ');
  return { latitude, longitude, label: label.length > 0 ? label : 'your location' };
}

interface Provider {
  name: string;
  url: string;
  read(json: Record<string, unknown>): GeoLocation | null;
}

const PROVIDERS: readonly Provider[] = [
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    read: (json) =>
      json['success'] === false
        ? null
        : toLocation(
            json['city'],
            json['region'],
            json['country'],
            json['latitude'],
            json['longitude'],
          ),
  },
  {
    name: 'geojs.io',
    url: 'https://get.geojs.io/v1/ip/geo.json',
    read: (json) =>
      toLocation(
        json['city'],
        json['region'],
        json['country'],
        json['latitude'],
        json['longitude'],
      ),
  },
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    read: (json) =>
      json['error'] === true
        ? null
        : toLocation(
            json['city'],
            json['region'],
            json['country_name'],
            json['latitude'],
            json['longitude'],
          ),
  },
];

/**
 * IP-based approximate location used as the default weather place. Providers are tried one
 * after another (never in parallel, so the IP address is only shared as far as needed) and a
 * successful answer is cached for six hours. Coordinates are never logged.
 */
export function createGeolocationService(options: GeolocationOptions): GeolocationService {
  const { logger } = options;
  let cached: { at: number; value: GeoLocation } | null = null;
  let pending: Promise<GeoLocation> | null = null;

  async function lookup(): Promise<GeoLocation> {
    for (const provider of PROVIDERS) {
      try {
        const json = await getJson(options.fetch, provider.url, PROVIDER_TIMEOUT_MS);
        const location = isRecord(json) ? provider.read(json) : null;
        if (location) return location;
        logger.warn(`Geolocation: ${provider.name} returned no usable location`);
      } catch (error) {
        logger.warn(`Geolocation: ${provider.name} failed`, error);
      }
    }
    throw new WeatherError('no-location', 'Could not determine the current location');
  }

  return {
    locate() {
      if (cached && options.now().getTime() - cached.at < CACHE_MS) {
        return Promise.resolve(cached.value);
      }
      pending ??= lookup()
        .then((value) => {
          cached = { at: options.now().getTime(), value };
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

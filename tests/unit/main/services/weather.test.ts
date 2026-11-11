import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeatherCondition } from '@shared/cards';
import { WeatherError } from '@main/commands/types';
import type { CommandSettings, WeatherErrorCode } from '@main/commands/types';
import type { GeolocationService } from '@main/services/geolocation';
import { createWeatherService } from '@main/services/weather';
import { createFakeLogger } from '../commands/helpers';

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

const PARIS = {
  name: 'Paris',
  latitude: 48.85341,
  longitude: 2.3488,
  country: 'France',
  country_code: 'FR',
  admin1: 'Île-de-France Region',
};

function dates(first: string, count: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

interface ForecastOptions {
  first?: string;
  codes?: Array<number | null>;
  max?: Array<number | null>;
  min?: Array<number | null>;
  probability?: Array<number | null> | undefined;
  extra?: Record<string, unknown>;
  current?: Record<string, unknown>;
}

/** A response shaped like Open-Meteo's, with Paris-like values. */
function forecastBody(options: ForecastOptions = {}): Record<string, unknown> {
  const codes = options.codes ?? [61, 3, 45, 2, 0, 80, 95];
  const time = dates(options.first ?? '2026-11-10', codes.length);
  return {
    latitude: 48.85,
    longitude: 2.35,
    utc_offset_seconds: 3600,
    timezone: 'Europe/Paris',
    current: {
      time: '2026-11-10T12:30',
      interval: 900,
      temperature_2m: 10.8,
      apparent_temperature: 9.4,
      relative_humidity_2m: 92,
      weather_code: 61,
      is_day: 1,
      wind_speed_10m: 7.4,
      ...options.current,
    },
    daily: {
      time,
      weather_code: codes,
      temperature_2m_max: options.max ?? codes.map((_, i) => 13.4 + i),
      temperature_2m_min: options.min ?? codes.map((_, i) => 8.5 - i),
      ...('probability' in options
        ? options.probability === undefined
          ? {}
          : { precipitation_probability_max: options.probability }
        : { precipitation_probability_max: codes.map((_, i) => 90 - i * 10) }),
    },
    ...options.extra,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

interface Backend {
  geocode?: (name: string) => Response | Promise<Response>;
  forecast?: (url: URL) => Response | Promise<Response>;
}

let clock = new Date('2026-11-10T11:30:00Z');

function setup(
  backend: Backend = {},
  options: {
    settings?: CommandSettings['weatherLocation'];
    geolocation?: GeolocationService;
  } = {},
) {
  const fetchFn = vi.fn<typeof fetch>((input) => {
    const url = new URL(urlOf(input));
    if (url.origin + url.pathname === GEOCODING) {
      const name = url.searchParams.get('name') ?? '';
      return Promise.resolve(backend.geocode ? backend.geocode(name) : json({ results: [PARIS] }));
    }
    if (url.origin + url.pathname === FORECAST) {
      return Promise.resolve(backend.forecast ? backend.forecast(url) : json(forecastBody()));
    }
    return Promise.reject(new TypeError(`unexpected request to ${url.href}`));
  });
  const locate = vi.fn(() =>
    Promise.resolve({ latitude: 18.52, longitude: 73.85, label: 'Pune, India' }),
  );
  const geolocation = options.geolocation ?? { locate };
  let settings = options.settings ?? { mode: 'auto' as const, city: '' };
  const logger = createFakeLogger();
  const weather = createWeatherService({
    fetch: fetchFn,
    geolocation,
    now: () => clock,
    logger,
    settings: () => settings,
  });
  return {
    weather,
    fetchFn,
    locate,
    logger,
    setSettings: (next: CommandSettings['weatherLocation']) => {
      settings = next;
    },
    calls: (kind: 'geocode' | 'forecast') =>
      fetchFn.mock.calls
        .map(([input]) => new URL(urlOf(input)))
        .filter((url) => url.href.startsWith(kind === 'geocode' ? GEOCODING : FORECAST)),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<WeatherErrorCode | 'resolved'> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WeatherError) return error.code;
    throw error;
  }
  return 'resolved';
}

afterEach(() => {
  vi.useRealTimers();
  clock = new Date('2026-11-10T11:30:00Z');
});

describe('weather service: requests', () => {
  it('geocodes the place and asks for a 7-day forecast', async () => {
    const { weather, calls } = setup();
    await weather.forecast({ place: 'Paris', units: 'metric' });

    expect(calls('geocode')[0]?.href).toBe(
      `${GEOCODING}?name=Paris&count=1&language=en&format=json`,
    );
    const url = calls('forecast')[0] ?? new URL('about:blank');
    expect(url.origin + url.pathname).toBe(FORECAST);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '48.8534',
      longitude: '2.3488',
      current:
        'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '7',
    });
  });

  it('asks for Fahrenheit and mph in imperial mode', async () => {
    const { weather, calls } = setup();
    const result = await weather.forecast({ place: 'Paris', units: 'imperial' });
    const params = calls('forecast')[0]?.searchParams;
    expect(params?.get('temperature_unit')).toBe('fahrenheit');
    expect(params?.get('wind_speed_unit')).toBe('mph');
    expect(result.units).toBe('imperial');
    expect(result.current.windUnit).toBe('mph');
  });

  it('encodes place names', async () => {
    const { weather, calls } = setup();
    await weather.forecast({ place: '  São Paulo, Brazil  ', units: 'metric' });
    expect(calls('geocode')[0]?.search).toContain('name=S%C3%A3o%20Paulo%2C%20Brazil');
    expect(calls('geocode')[0]?.searchParams.get('name')).toBe('São Paulo, Brazil');
  });
});

describe('weather service: mapping', () => {
  it('turns the response into a weather card payload', async () => {
    const { weather } = setup();
    const result = await weather.forecast({ place: 'Paris', units: 'metric' });

    expect(result).toMatchObject({
      kind: 'weather',
      place: 'Paris, France',
      units: 'metric',
      current: {
        temp: 11,
        feelsLike: 9,
        condition: 'rain',
        summary: 'Light rain',
        isDay: true,
        humidity: 92,
        windSpeed: 7,
        windUnit: 'km/h',
      },
    });
    expect(result.days).toHaveLength(7);
    expect(result.days[0]).toEqual({
      date: '2026-11-10',
      label: 'Today',
      condition: 'rain',
      summary: 'Light rain',
      tempMax: 13,
      tempMin: 9,
      precipChance: 90,
    });
    expect(result.days[1]).toMatchObject({
      label: 'Tomorrow',
      condition: 'cloudy',
      precipChance: 80,
    });
    expect(result.days.map((day) => day.label)).toEqual([
      'Today',
      'Tomorrow',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
      'Mon',
    ]);
  });

  it('knows whether it is night', async () => {
    const { weather } = setup({ forecast: () => json(forecastBody({ current: { is_day: 0 } })) });
    expect((await weather.forecast({ place: 'Paris', units: 'metric' })).current.isDay).toBe(false);
  });

  it.each<[number, WeatherCondition, string]>([
    [0, 'clear', 'Clear sky'],
    [1, 'clear', 'Mainly clear'],
    [2, 'partly-cloudy', 'Partly cloudy'],
    [3, 'cloudy', 'Overcast'],
    [45, 'fog', 'Fog'],
    [48, 'fog', 'Freezing fog'],
    [51, 'drizzle', 'Light drizzle'],
    [53, 'drizzle', 'Drizzle'],
    [55, 'drizzle', 'Heavy drizzle'],
    [56, 'drizzle', 'Light freezing drizzle'],
    [57, 'drizzle', 'Freezing drizzle'],
    [61, 'rain', 'Light rain'],
    [63, 'rain', 'Rain'],
    [65, 'rain', 'Heavy rain'],
    [66, 'rain', 'Light freezing rain'],
    [67, 'rain', 'Freezing rain'],
    [71, 'snow', 'Light snow'],
    [73, 'snow', 'Snow'],
    [75, 'snow', 'Heavy snow'],
    [77, 'snow', 'Snow grains'],
    [80, 'rain', 'Light rain showers'],
    [81, 'rain', 'Rain showers'],
    [82, 'rain', 'Heavy rain showers'],
    [85, 'snow', 'Light snow showers'],
    [86, 'snow', 'Heavy snow showers'],
    [95, 'thunderstorm', 'Thunderstorm'],
    [96, 'thunderstorm', 'Thunderstorm with hail'],
    [99, 'thunderstorm', 'Thunderstorm with heavy hail'],
    [42, 'cloudy', 'Cloudy'],
  ])('weather code %s means %s (%s)', async (code, condition, summary) => {
    const { weather } = setup({
      forecast: () => json(forecastBody({ codes: [code], current: { weather_code: code } })),
    });
    const result = await weather.forecast({ place: 'Paris', units: 'metric' });
    expect(result.current).toMatchObject({ condition, summary });
    expect(result.days[0]).toMatchObject({ condition, summary });
  });

  it('estimates the chance of rain from the weather code when the model gives none', async () => {
    const body = forecastBody({ codes: [0, 3, 51, 63, 73, 95], probability: undefined });
    const { weather } = setup({ forecast: () => json(body) });
    const result = await weather.forecast({ place: 'Paris', units: 'metric' });
    expect(result.days.map((day) => day.precipChance)).toEqual([0, 0, 40, 70, 60, 70]);
  });

  it('uses the model probability where it exists and clamps it', async () => {
    const body = forecastBody({ codes: [63, 63, 63], probability: [null, 130, -5] });
    const { weather } = setup({ forecast: () => json(body) });
    const result = await weather.forecast({ place: 'Paris', units: 'metric' });
    expect(result.days.map((day) => day.precipChance)).toEqual([70, 100, 0]);
  });

  it('skips days with missing values and rounds the rest', async () => {
    const body = forecastBody({
      codes: [61, null, 3, 3],
      max: [13.5, 12, null, 11.4],
      min: [8.5, 7, 6, 5.6],
    });
    const { weather } = setup({ forecast: () => json(body) });
    const result = await weather.forecast({ place: 'Paris', units: 'metric' });
    expect(result.days.map((day) => [day.date, day.tempMax, day.tempMin])).toEqual([
      ['2026-11-10', 14, 9],
      ['2026-11-13', 11, 6],
    ]);
  });

  describe('place labels', () => {
    const label = async (result: Record<string, unknown>) => {
      const { weather } = setup({
        geocode: () => json({ results: [{ latitude: 1, longitude: 2, ...result }] }),
      });
      return (await weather.forecast({ place: 'anywhere', units: 'metric' })).place;
    };

    it('writes "City, Country"', async () => {
      expect(await label(PARIS)).toBe('Paris, France');
    });

    it('adds the state where that is how people name places', async () => {
      expect(
        await label({
          name: 'Austin',
          country: 'United States',
          country_code: 'US',
          admin1: 'Texas',
        }),
      ).toBe('Austin, Texas, United States');
      expect(
        await label({ name: 'Calgary', country: 'Canada', country_code: 'CA', admin1: 'Alberta' }),
      ).toBe('Calgary, Alberta, Canada');
    });

    it('leaves out a state that repeats the city', async () => {
      expect(
        await label({
          name: 'New York',
          country: 'United States',
          country_code: 'US',
          admin1: 'New York',
        }),
      ).toBe('New York, United States');
    });

    it('copes with missing details', async () => {
      expect(await label({ name: 'Atlantis', country_code: 'XX' })).toBe('Atlantis, XX');
      expect(await label({ name: 'Atlantis' })).toBe('Atlantis');
    });
  });

  describe('day labels follow the place, not this PC', () => {
    it('knows it is already tomorrow in Tokyo', async () => {
      clock = new Date('2026-11-10T23:30:00Z');
      const body = forecastBody({
        first: '2026-11-11',
        extra: { utc_offset_seconds: 32_400, timezone: 'Asia/Tokyo' },
      });
      const { weather } = setup({ forecast: () => json(body) });
      const result = await weather.forecast({ place: 'Tokyo', units: 'metric' });
      expect(result.days.slice(0, 3).map((day) => day.label)).toEqual(['Today', 'Tomorrow', 'Fri']);
    });

    it('knows it is still yesterday in Los Angeles', async () => {
      clock = new Date('2026-11-10T03:00:00Z');
      const body = forecastBody({
        first: '2026-11-09',
        extra: { utc_offset_seconds: -28_800, timezone: 'America/Los_Angeles' },
      });
      const { weather } = setup({ forecast: () => json(body) });
      const result = await weather.forecast({ place: 'Los Angeles', units: 'metric' });
      expect(result.days.slice(0, 2).map((day) => day.label)).toEqual(['Today', 'Tomorrow']);
    });

    it('falls back to the zone name, then to the response clock', async () => {
      clock = new Date('2026-11-10T23:30:00Z');
      const noOffset = forecastBody({
        first: '2026-11-11',
        extra: { utc_offset_seconds: undefined, timezone: 'Asia/Tokyo' },
      });
      const tokyo = setup({ forecast: () => json(noOffset) });
      const byZone = await tokyo.weather.forecast({ place: 'Tokyo', units: 'metric' });
      expect(byZone.days[0]?.label).toBe('Today');

      const badZone = forecastBody({
        extra: { utc_offset_seconds: undefined, timezone: 'Mars/Olympus' },
      });
      const mars = setup({ forecast: () => json(badZone) });
      const byResponseClock = await mars.weather.forecast({ place: 'Mars', units: 'metric' });
      expect(byResponseClock.days[0]?.label).toBe('Today');

      const bare = forecastBody({
        first: '2026-11-12',
        current: { time: undefined },
        extra: { utc_offset_seconds: undefined, timezone: undefined },
      });
      const clockless = setup({ forecast: () => json(bare) });
      const byFirstDay = await clockless.weather.forecast({ place: 'Nowhere', units: 'metric' });
      expect(byFirstDay.days[0]?.label).toBe('Today');
    });
  });
});

describe('weather service: failures', () => {
  it('reports an unknown place', async () => {
    const empty = setup({ geocode: () => json({ generationtime_ms: 0.17 }) });
    expect(await codeOf(empty.weather.forecast({ place: 'xyzzyqwerty', units: 'metric' }))).toBe(
      'not-found',
    );
    expect(empty.calls('forecast')).toHaveLength(0);
    const none = setup({ geocode: () => json({ results: [] }) });
    expect(await codeOf(none.weather.forecast({ place: 'xyzzyqwerty', units: 'metric' }))).toBe(
      'not-found',
    );
  });

  it('does not bother the network with one-letter names', async () => {
    const { weather, fetchFn } = setup();
    expect(await codeOf(weather.forecast({ place: 'x', units: 'metric' }))).toBe('not-found');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports a network failure as no-network', async () => {
    const { weather, logger } = setup({ geocode: () => Promise.reject(new TypeError('offline')) });
    expect(await codeOf(weather.forecast({ place: 'Paris', units: 'metric' }))).toBe('no-network');
    expect(logger.warn).toHaveBeenCalled();
    const forecastDown = setup({ forecast: () => Promise.reject(new TypeError('offline')) });
    expect(await codeOf(forecastDown.weather.forecast({ place: 'Paris', units: 'metric' }))).toBe(
      'no-network',
    );
  });

  it('gives up after eight seconds', async () => {
    vi.useFakeTimers();
    const hang = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        }),
    );
    const weather = createWeatherService({
      fetch: hang,
      geolocation: { locate: () => Promise.reject(new Error('unused')) },
      now: () => clock,
      logger: createFakeLogger(),
      settings: () => ({ mode: 'auto', city: '' }),
    });
    const result = codeOf(weather.forecast({ place: 'Paris', units: 'metric' }));
    await vi.advanceTimersByTimeAsync(7999);
    expect(hang.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('no-network');
  });

  it.each([
    ['an HTTP error', () => json({ reason: 'rate limit' }, 429)],
    ['text instead of JSON', () => new Response('<html>')],
    [
      'an unexpected shape',
      () => json({ results: [{ name: 'Paris', latitude: 'north', longitude: 2 }] }),
    ],
  ])('reports %s from the geocoder as bad-response', async (_label, geocode) => {
    const { weather } = setup({ geocode });
    expect(await codeOf(weather.forecast({ place: 'Paris', units: 'metric' }))).toBe(
      'bad-response',
    );
  });

  it.each([
    ['an HTTP error', () => json({}, 500)],
    ['text instead of JSON', () => new Response('nope')],
    ['a missing current block', () => json({ ...forecastBody(), current: undefined })],
    ['numbers sent as text', () => json(forecastBody({ current: { temperature_2m: 'warm' } }))],
    ['an empty daily block', () => json(forecastBody({ codes: [] }))],
    ['only unusable days', () => json(forecastBody({ codes: [null, null] }))],
  ])('reports %s from the forecast as bad-response', async (_label, forecast) => {
    const { weather } = setup({ forecast });
    expect(await codeOf(weather.forecast({ place: 'Paris', units: 'metric' }))).toBe(
      'bad-response',
    );
  });

  it('does not remember failures', async () => {
    let healthy = false;
    const { weather, calls } = setup({
      forecast: () => (healthy ? json(forecastBody()) : json({}, 500)),
    });
    expect(await codeOf(weather.forecast({ place: 'Paris', units: 'metric' }))).toBe(
      'bad-response',
    );
    healthy = true;
    expect(await codeOf(weather.forecast({ place: 'Paris', units: 'metric' }))).toBe('resolved');
    expect(calls('forecast')).toHaveLength(2);
  });
});

describe('weather service: the default place', () => {
  it('uses IP geolocation in automatic mode', async () => {
    const { weather, calls, locate } = setup();
    const result = await weather.forecast({ units: 'metric' });
    expect(locate).toHaveBeenCalledTimes(1);
    expect(calls('geocode')).toHaveLength(0);
    expect(result.place).toBe('Pune, India');
    expect(calls('forecast')[0]?.searchParams.get('latitude')).toBe('18.5200');
    expect(calls('forecast')[0]?.searchParams.get('longitude')).toBe('73.8500');
  });

  it('uses the city from Settings in manual mode', async () => {
    const { weather, calls, locate } = setup(
      {},
      { settings: { mode: 'manual', city: ' Berlin ' } },
    );
    await weather.forecast({ units: 'metric' });
    expect(locate).not.toHaveBeenCalled();
    expect(calls('geocode')[0]?.searchParams.get('name')).toBe('Berlin');
  });

  it('lets an explicit place win over the settings', async () => {
    const { weather, calls, locate } = setup({}, { settings: { mode: 'manual', city: 'Berlin' } });
    await weather.forecast({ place: 'Rome', units: 'metric' });
    expect(calls('geocode')[0]?.searchParams.get('name')).toBe('Rome');
    expect(locate).not.toHaveBeenCalled();
  });

  it('falls back to geolocation in manual mode without a city', async () => {
    const { weather, locate } = setup({}, { settings: { mode: 'manual', city: '   ' } });
    await weather.forecast({ units: 'metric' });
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it('falls back to the typed city when geolocation fails in automatic mode', async () => {
    const geolocation = { locate: () => Promise.reject(new WeatherError('no-location', 'nope')) };
    const { weather, calls } = setup({}, { settings: { mode: 'auto', city: 'Oslo' }, geolocation });
    await weather.forecast({ units: 'metric' });
    expect(calls('geocode')[0]?.searchParams.get('name')).toBe('Oslo');
  });

  it('reports no-location when there is nothing to fall back to', async () => {
    const geolocation = { locate: () => Promise.reject(new WeatherError('no-location', 'nope')) };
    const { weather } = setup({}, { geolocation });
    expect(await codeOf(weather.forecast({ units: 'metric' }))).toBe('no-location');
  });

  it('does not hide other geolocation problems', async () => {
    const geolocation = { locate: () => Promise.reject(new Error('disk on fire')) };
    const { weather } = setup({}, { settings: { mode: 'auto', city: 'Oslo' }, geolocation });
    await expect(weather.forecast({ units: 'metric' })).rejects.toThrow('disk on fire');
  });

  it('reports an unknown manual city as not-found', async () => {
    const { weather } = setup(
      { geocode: () => json({}) },
      { settings: { mode: 'manual', city: 'Atlantis' } },
    );
    expect(await codeOf(weather.forecast({ units: 'metric' }))).toBe('not-found');
  });

  it('reads the settings on every request', async () => {
    const { weather, setSettings, calls, locate } = setup();
    await weather.forecast({ units: 'metric' });
    setSettings({ mode: 'manual', city: 'Berlin' });
    const result = await weather.forecast({ units: 'metric' });
    expect(locate).toHaveBeenCalledTimes(1);
    expect(calls('geocode')).toHaveLength(1);
    expect(result.place).toBe('Paris, France');
  });
});

describe('weather service: cache', () => {
  const request = { place: 'Paris', units: 'metric' as const };

  it('answers identical requests from memory for ten minutes', async () => {
    const { weather, calls } = setup();
    await weather.forecast(request);
    clock = new Date(clock.getTime() + 10 * 60_000 - 1);
    await weather.forecast(request);
    expect(calls('forecast')).toHaveLength(1);
    expect(calls('geocode')).toHaveLength(1);
    clock = new Date(clock.getTime() + 2);
    await weather.forecast(request);
    expect(calls('forecast')).toHaveLength(2);
  });

  it('treats a different spelling case as the same request but not a different unit', async () => {
    const { weather, calls } = setup();
    await weather.forecast({ place: 'Paris', units: 'metric' });
    await weather.forecast({ place: ' paris ', units: 'metric' });
    expect(calls('forecast')).toHaveLength(1);
    await weather.forecast({ place: 'Paris', units: 'imperial' });
    expect(calls('forecast')).toHaveLength(2);
  });

  it('keeps the default place apart from named places and from other settings', async () => {
    const { weather, calls, setSettings } = setup();
    await weather.forecast({ units: 'metric' });
    await weather.forecast({ place: 'Paris', units: 'metric' });
    expect(calls('forecast')).toHaveLength(2);
    await weather.forecast({ units: 'metric' });
    expect(calls('forecast')).toHaveLength(2);
    setSettings({ mode: 'manual', city: 'Berlin' });
    await weather.forecast({ units: 'metric' });
    expect(calls('forecast')).toHaveLength(3);
  });

  it('hands out copies so callers cannot damage the cache', async () => {
    const { weather } = setup();
    const first = await weather.forecast(request);
    first.days.length = 0;
    first.current.temp = -99;
    const second = await weather.forecast(request);
    expect(second.days).toHaveLength(7);
    expect(second.current.temp).toBe(11);
  });

  it('forgets the least recently used of ten places', async () => {
    const { weather, calls } = setup();
    const names = 'abcdefghij'.split('').map((letter) => `city ${letter}`);
    for (const place of names) await weather.forecast({ place, units: 'metric' });
    expect(calls('forecast')).toHaveLength(10);

    await weather.forecast({ place: 'city a', units: 'metric' });
    await weather.forecast({ place: 'city k', units: 'metric' });
    expect(calls('forecast')).toHaveLength(11);

    await weather.forecast({ place: 'city a', units: 'metric' });
    expect(calls('forecast')).toHaveLength(11);
    await weather.forecast({ place: 'city b', units: 'metric' });
    expect(calls('forecast')).toHaveLength(12);
  });
});

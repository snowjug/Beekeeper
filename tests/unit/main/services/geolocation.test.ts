import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeolocationService } from '@main/services/geolocation';
import { WeatherError } from '@main/commands/types';
import { createFakeLogger } from '../commands/helpers';

const IPWHO = 'https://ipwho.is/';
const GEOJS = 'https://get.geojs.io/v1/ip/geo.json';
const IPAPI = 'https://ipapi.co/json/';

type Handler = () => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function fakeFetch(routes: Record<string, Handler>) {
  return vi.fn<typeof fetch>((input) => {
    const handler = routes[urlOf(input)];
    return handler
      ? Promise.resolve(handler())
      : Promise.reject(new TypeError(`unexpected request to ${urlOf(input)}`));
  });
}

const PUNE = {
  success: true,
  city: 'Pune',
  region: 'Maharashtra',
  country: 'India',
  latitude: 18.52,
  longitude: 73.85,
};

let clock = new Date('2026-11-10T10:00:00Z');

function service(routes: Record<string, Handler>) {
  const fetchFn = fakeFetch(routes);
  const logger = createFakeLogger();
  const geolocation = createGeolocationService({ fetch: fetchFn, now: () => clock, logger });
  return { geolocation, fetchFn, logger };
}

beforeEach(() => {
  clock = new Date('2026-11-10T10:00:00Z');
});

afterEach(() => {
  vi.useRealTimers();
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WeatherError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('geolocation provider chain', () => {
  it('uses the first provider that answers', async () => {
    const { geolocation, fetchFn } = service({ [IPWHO]: () => json(PUNE) });
    await expect(geolocation.locate()).resolves.toEqual({
      latitude: 18.52,
      longitude: 73.85,
      label: 'Pune, India',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls through to geojs, whose coordinates are strings', async () => {
    const { geolocation, fetchFn, logger } = service({
      [IPWHO]: () => json({ success: false, message: 'Reserved range' }),
      [GEOJS]: () =>
        json({
          city: 'London',
          region: 'England',
          country: 'United Kingdom',
          latitude: '51.5074',
          longitude: '-0.1278',
        }),
    });
    await expect(geolocation.locate()).resolves.toEqual({
      latitude: 51.5074,
      longitude: -0.1278,
      label: 'London, United Kingdom',
    });
    expect(fetchFn.mock.calls.map(([url]) => urlOf(url))).toEqual([IPWHO, GEOJS]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('ends with ipapi.co', async () => {
    const { geolocation } = service({
      [IPWHO]: () => json({}, 500),
      [GEOJS]: () => Promise.reject(new TypeError('offline')),
      [IPAPI]: () =>
        json({
          city: 'Berlin',
          region: 'Berlin',
          country: 'DE',
          country_name: 'Germany',
          latitude: 52.52,
          longitude: 13.4,
        }),
    });
    await expect(geolocation.locate()).resolves.toMatchObject({ label: 'Berlin, Germany' });
  });

  it('rejects an ipapi.co error body', async () => {
    const { geolocation } = service({
      [IPAPI]: () => json({ error: true, reason: 'RateLimited' }),
    });
    expect(await code(geolocation.locate())).toBe('no-location');
  });

  it('gives up with no-location when every provider fails', async () => {
    const { geolocation, fetchFn, logger } = service({});
    expect(await code(geolocation.locate())).toBe('no-location');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('moves on after three seconds of silence', async () => {
    vi.useFakeTimers();
    const silent = vi.fn<typeof fetch>((input, init) => {
      if (urlOf(input) === IPWHO) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        });
      }
      return Promise.resolve(
        json({ city: 'Oslo', country: 'Norway', latitude: '59.9', longitude: '10.7' }),
      );
    });
    const geolocation = createGeolocationService({
      fetch: silent,
      now: () => clock,
      logger: createFakeLogger(),
    });
    const pending = geolocation.locate();
    await vi.advanceTimersByTimeAsync(2999);
    expect(silent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ label: 'Oslo, Norway' });
    expect(silent).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['null island', { latitude: 0, longitude: 0, city: 'Nowhere' }],
    ['latitude out of range', { latitude: 91, longitude: 10 }],
    ['longitude out of range', { latitude: 10, longitude: -181 }],
    ['missing coordinates', { city: 'Pune' }],
    ['blank coordinates', { latitude: '', longitude: ' ' }],
    ['words instead of coordinates', { latitude: 'north', longitude: 'east' }],
    ['null coordinates', { latitude: null, longitude: null }],
  ])('rejects %s', async (_label, body) => {
    const { geolocation } = service({
      [IPWHO]: () => json(body),
      [GEOJS]: () => json(body),
      [IPAPI]: () => json(body),
    });
    expect(await code(geolocation.locate())).toBe('no-location');
  });

  it('ignores bodies that are not objects', async () => {
    const { geolocation } = service({
      [IPWHO]: () => json([1, 2, 3]),
      [GEOJS]: () => json('hello'),
      [IPAPI]: () => json(null),
    });
    expect(await code(geolocation.locate())).toBe('no-location');
  });

  it.each([
    [{ city: 'Pune', region: 'MH', country: 'India' }, 'Pune, India'],
    [{ city: '', region: 'Maharashtra', country: 'India' }, 'Maharashtra, India'],
    [{ city: 'Pune' }, 'Pune'],
    [{ country: 'India' }, 'India'],
    [{}, 'your location'],
  ])('labels %j as %s', async (fields, label) => {
    const { geolocation } = service({
      [IPWHO]: () => json({ latitude: 18.5, longitude: 73.8, ...fields }),
    });
    await expect(geolocation.locate()).resolves.toMatchObject({ label });
  });

  it('never writes coordinates to the log', async () => {
    const { geolocation, logger } = service({
      [IPWHO]: () => json({ success: false }),
      [GEOJS]: () => json({ latitude: '48.8566', longitude: '0' }),
      [IPAPI]: () => json({ latitude: 48.8566, longitude: 2.3522 }),
    });
    await geolocation.locate();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/48\.85|2\.35/);
  });
});

describe('geolocation cache', () => {
  it('remembers the answer for six hours', async () => {
    const { geolocation, fetchFn } = service({ [IPWHO]: () => json(PUNE) });
    await geolocation.locate();
    clock = new Date(clock.getTime() + 6 * 3600 * 1000 - 1);
    await geolocation.locate();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock = new Date(clock.getTime() + 2);
    await geolocation.locate();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between simultaneous callers', async () => {
    const { geolocation, fetchFn } = service({ [IPWHO]: () => json(PUNE) });
    const [a, b] = await Promise.all([geolocation.locate(), geolocation.locate()]);
    expect(a).toEqual(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not remember failures', async () => {
    let healthy = false;
    const { geolocation, fetchFn } = service({
      [IPWHO]: () => (healthy ? json(PUNE) : json({}, 503)),
      [GEOJS]: () => json({}, 503),
      [IPAPI]: () => json({}, 503),
    });
    expect(await code(geolocation.locate())).toBe('no-location');
    healthy = true;
    await expect(geolocation.locate()).resolves.toMatchObject({ label: 'Pune, India' });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});

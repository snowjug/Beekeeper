import { describe, expect, it, vi } from 'vitest';
import type { StatusCard, WeatherCard } from '@shared/cards';
import { weatherCommand } from '@main/commands/info/weather';
import type { WeatherSlots } from '@main/commands/info/weather';
import { WeatherError } from '@main/commands/types';
import type { WeatherErrorCode, WeatherService } from '@main/commands/types';
import {
  createFakeLogger,
  createFakeServices,
  matchOf,
  parseContext,
  runContext,
  sampleForecast,
  turn,
} from '../helpers';

// NOW is a Tuesday: Saturday is 4 days away, Monday 6.
const general = (extra: Partial<WeatherSlots> = {}): WeatherSlots => ({
  day: 0,
  question: 'general',
  ...extra,
});

describe('weather: phrases', () => {
  it.each<[string, WeatherSlots]>([
    ['weather', general()],
    ["what's the weather", general()],
    ['how is the weather', general()],
    ['weather report', general()],
    ['forecast', general()],
    ['weather in paris', general({ place: 'paris' })],
    ["what's the weather like in new york", general({ place: 'new york' })],
    ["how's the weather in tokyo today", general({ place: 'tokyo' })],
    ["what's the weather going to be like tomorrow", general({ day: 1 })],
    ['forecast for tomorrow', general({ day: 1 })],
    ['weather tomorrow in berlin', general({ day: 1, place: 'berlin' })],
    ['weather in paris tomorrow morning', general({ day: 1, place: 'paris' })],
    ['will it rain this afternoon', { day: 0, question: 'rain' }],
    ['will it rain saturday night', { day: 4, question: 'rain' }],
    ["what's the weather in san francisco tomorrow", general({ day: 1, place: 'san francisco' })],
    ['weather on saturday', general({ day: 4 })],
    ['what is the forecast for friday', general({ day: 3 })],
    ['weather this weekend', general({ day: 4 })],
    ['weather on tuesday', general({ day: 0 })],
    ['weather the day after tomorrow', general({ day: 2 })],
    ['weather in 3 days', general({ day: 3 })],
    ['weather next monday', general({ day: 6 })],
    ['weather in paris, france', general({ place: 'paris, france' })],
    ['weather in the uk', general({ place: 'uk' })],
    ['weather in new york city tomorrow', general({ day: 1, place: 'new york city' })],
    ['weather in 10001', general({ place: '10001' })],
    ['paris weather', general({ place: 'paris' })],
    ['weather paris tomorrow', general({ day: 1, place: 'paris' })],
    ['weather forecast paris', general({ place: 'paris' })],
    ['paris weather forecast', general({ place: 'paris' })],
    ['new york weather report', general({ place: 'new york' })],
    ['weather forecast for tomorrow', general({ day: 1 })],
    ['weather near me', general()],
    ['weather here', general()],
    ["what's the weather like in my area", general()],
    ['will it rain tomorrow', { day: 1, question: 'rain' }],
    ['is it going to rain today in london', { day: 0, question: 'rain', place: 'london' }],
    ['do I need an umbrella', { day: 0, question: 'rain' }],
    ['is it raining', { day: 0, question: 'rain' }],
    ['will it snow tomorrow', { day: 1, question: 'rain' }],
    ['chance of rain tomorrow', { day: 1, question: 'rain' }],
    ['will it rain in london on friday', { day: 3, question: 'rain', place: 'london' }],
    ['rain in london tomorrow', { day: 1, question: 'rain', place: 'london' }],
    ['how hot is it', { day: 0, question: 'temperature' }],
    ["what's the temperature", { day: 0, question: 'temperature' }],
    ['temperature in dubai', { day: 0, question: 'temperature', place: 'dubai' }],
    ['how cold is it in dubai', { day: 0, question: 'temperature', place: 'dubai' }],
    ['is it hot outside', { day: 0, question: 'temperature' }],
    ['is it going to be cold tonight', { day: 0, question: 'temperature' }],
    ['is it windy', general()],
    ['will it be sunny tomorrow', general({ day: 1 })],
    ['hey beekeeper what is the weather like', general()],
    ['please tell me the weather in paris', general({ place: 'paris' })],
    ['can you check the weather in tokyo', general({ place: 'tokyo' })],
  ])('%s', (text, slots) => {
    expect(matchOf(weatherCommand, text)?.slots).toEqual(slots);
  });

  it('scores unmistakable phrases above hunches, and typos below both', () => {
    expect(matchOf(weatherCommand, "what's the weather")?.score).toBe(0.95);
    expect(matchOf(weatherCommand, 'how hot is it')?.score).toBe(0.9);
    expect(matchOf(weatherCommand, 'rain in london tomorrow')?.score).toBe(0.9);
    expect(matchOf(weatherCommand, 'wether in paris')?.score).toBeCloseTo(0.85);
    expect(matchOf(weatherCommand, 'how hot is it')?.score).toBeLessThan(0.95);
  });

  it.each([
    ['wether in paris', general({ place: 'paris' })],
    ['whats the wheather', general()],
    ['weather tommorow in rome', general({ day: 1, place: 'rome' })],
    ['tomorow weather', general({ day: 1 })],
    ['weather on saterday', general({ day: 4 })],
  ])('repairs the typo in %s', (text, slots) => {
    const match = matchOf(weatherCommand, text);
    expect(match?.slots).toEqual(slots);
    expect(match?.score).toBeLessThan(0.9);
  });

  it.each([
    'search for weather in paris',
    'google the weather',
    'open weather app',
    'weather app',
    'weather channel',
    'sales forecast',
    'london forecast',
    'rain',
    'snow',
    'umbrella',
    'play rain sounds',
    'do I need a jacket',
    'what should i wear',
    'set the temperature to 70',
    'what time is it',
    'how are you',
    "how's it going",
    'weather in my room',
    'weather in a bit',
    "what's the weather in paris and london",
    'weather next week',
    'weather next tuesday',
    'weather in 7 days',
    '',
  ])('does not claim %j', (text) => {
    expect(matchOf(weatherCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(weatherCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of weatherCommand.examples) {
      expect(matchOf(weatherCommand, example), example).not.toBeNull();
    }
  });
});

describe('weather: follow-ups', () => {
  const parisTurn = (extra: Partial<Parameters<typeof turn>[2]> = {}) =>
    turn('weather', 'weather in paris', {
      slots: { place: 'paris', day: 0, question: 'general' },
      context: { place: 'Paris, France', focusDay: 0 },
      ...extra,
    });
  const afterParis = parseContext([parisTurn()]);

  it.each<[string, WeatherSlots]>([
    ['what about tomorrow', general({ day: 1, place: 'Paris, France' })],
    ['and tomorrow', general({ day: 1, place: 'Paris, France' })],
    ['tomorrow', general({ day: 1, place: 'Paris, France' })],
    ['what about saturday', general({ day: 4, place: 'Paris, France' })],
    ['what about on friday', general({ day: 3, place: 'Paris, France' })],
    ['what about the day after tomorrow', general({ day: 2, place: 'Paris, France' })],
    ['and in london', general({ place: 'london' })],
    ['in london', general({ place: 'london' })],
    ['how about berlin', general({ place: 'berlin' })],
    ['what about paris tomorrow', general({ day: 1, place: 'paris' })],
    ['and in london tomorrow', general({ day: 1, place: 'london' })],
    ['what about tomorrow in rome', general({ day: 1, place: 'rome' })],
    ['what about the new york', general({ place: 'new york' })],
    ['whats about tomorow', general({ day: 1, place: 'Paris, France' })],
  ])('after a weather answer, "%s" asks again', (text, slots) => {
    expect(matchOf(weatherCommand, text, afterParis)?.slots).toEqual(slots);
  });

  it('keeps the day and the kind of question of the previous answer', () => {
    const ctx = parseContext([
      parisTurn({
        slots: { place: 'paris', day: 1, question: 'rain' },
        context: { place: 'Paris, France', focusDay: 1 },
      }),
    ]);
    expect(matchOf(weatherCommand, 'and in london', ctx)?.slots).toEqual({
      place: 'london',
      day: 1,
      question: 'rain',
    });
    expect(matchOf(weatherCommand, 'what about saturday', ctx)?.slots).toEqual({
      place: 'Paris, France',
      day: 4,
      question: 'rain',
    });
  });

  it('uses the default place when the previous answer was for it', () => {
    const ctx = parseContext([turn('weather', 'weather', { context: { focusDay: 0 } })]);
    expect(matchOf(weatherCommand, 'what about tomorrow', ctx)?.slots).toEqual(general({ day: 1 }));
    const bare = parseContext([turn('weather', 'weather')]);
    expect(matchOf(weatherCommand, 'what about tomorrow', bare)?.slots).toEqual(
      general({ day: 1 }),
    );
  });

  it('ignores damaged context from the previous turn', () => {
    const ctx = parseContext([
      turn('weather', 'weather', {
        slots: 'nonsense',
        context: { place: '', focusDay: 99 },
      }),
    ]);
    expect(matchOf(weatherCommand, 'what about tomorrow', ctx)?.slots).toEqual(general({ day: 1 }));
    const odd = parseContext([
      turn('weather', 'weather', { slots: { question: 'dance' }, context: { focusDay: 'soon' } }),
    ]);
    expect(matchOf(weatherCommand, 'and in london', odd)?.slots).toEqual(
      general({ place: 'london' }),
    );
  });

  it('scores follow-ups, with less for typos', () => {
    expect(matchOf(weatherCommand, 'what about tomorrow', afterParis)?.score).toBe(0.9);
    expect(matchOf(weatherCommand, 'what about tomorow', afterParis)?.score).toBe(0.8);
  });

  it.each([
    'what about tomorrow',
    'and in london',
    'how about berlin',
    'what about saturday',
    'and tomorrow',
    'what about paris tomorrow',
    'tomorrow',
  ])('"%s" means nothing without a preceding weather answer', (text) => {
    expect(matchOf(weatherCommand, text)).toBeNull();
    const other = parseContext([turn('battery', 'battery status')]);
    expect(matchOf(weatherCommand, text, other)).toBeNull();
    const buried = parseContext([parisTurn(), turn('battery', 'battery status')]);
    expect(matchOf(weatherCommand, text, buried)).toBeNull();
    const fallback = parseContext([parisTurn(), turn(null, 'who is ada lovelace')]);
    expect(matchOf(weatherCommand, text, fallback)).toBeNull();
  });

  it.each([
    'how about a pizza',
    'what about my meeting',
    'what about we go out',
    'and then',
    'what about next tuesday',
    'what about',
    'what about here',
  ])('does not treat "%s" as a weather follow-up', (text) => {
    expect(matchOf(weatherCommand, text, afterParis)).toBeNull();
  });

  it('still understands a full question after a weather answer', () => {
    expect(matchOf(weatherCommand, 'what about the weather in berlin', afterParis)?.slots).toEqual(
      general({ place: 'berlin' }),
    );
  });
});

describe('weather: answers', () => {
  const run = async (
    slots: WeatherSlots,
    options: { forecast?: ReturnType<typeof sampleForecast>; units?: 'metric' | 'imperial' } = {},
  ) => {
    const services = createFakeServices();
    const forecast = vi.fn<WeatherService['forecast']>(() =>
      Promise.resolve(options.forecast ?? sampleForecast()),
    );
    services.weather = { forecast };
    const ctx = runContext({ services, settings: { units: options.units ?? 'metric' } });
    const result = await weatherCommand.run(slots, ctx);
    return { result, forecast, card: result.cards[0] as WeatherCard };
  };

  it('summarises today for the default place', async () => {
    const { result, forecast, card } = await run(general());
    expect(forecast).toHaveBeenCalledWith({ place: undefined, units: 'metric' });
    expect(card).toMatchObject({
      kind: 'weather',
      id: 'id-1',
      place: 'Paris, France',
      focusDay: 0,
      openUrl: 'https://www.bing.com/search?q=weather%20Paris%2C%20France',
    });
    expect(card.days).toHaveLength(7);
    expect(card.verdict).toBeUndefined();
    expect(card.copyText).toBe(
      'Weather in Paris, France: 18°C, partly cloudy (feels like 17°C)\nToday: partly cloudy, high 21°C, low 12°C, 10% chance of rain',
    );
    expect(result.speech).toBe("It's 18 degrees and partly cloudy in Paris. Today's high is 21.");
    expect(result.context).toEqual({ focusDay: 0 });
  });

  it('remembers a named place and the day for follow-ups', async () => {
    const { forecast, result } = await run(general({ place: 'paris', day: 1 }));
    expect(forecast).toHaveBeenCalledWith({ place: 'paris', units: 'metric' });
    expect(result.context).toEqual({ place: 'Paris, France', focusDay: 1 });
  });

  it('passes the unit system on and writes Fahrenheit', async () => {
    const forecast = sampleForecast({ units: 'imperial' });
    const { forecast: spy, card } = await run(general(), { forecast, units: 'imperial' });
    expect(spy).toHaveBeenCalledWith({ place: undefined, units: 'imperial' });
    expect(card.copyText).toContain('°F');
  });

  it('answers rain questions with a verdict', async () => {
    const { result, card } = await run({ place: 'paris', day: 1, question: 'rain' });
    expect(card.focusDay).toBe(1);
    expect(card.verdict).toBe('Yes — rain is likely tomorrow (80%)');
    expect(result.speech).toBe(
      "Yes, rain is likely tomorrow in Paris. There's an 80 percent chance.",
    );
  });

  it.each([
    [
      0,
      'Probably not — only a 10% chance of rain today',
      'Probably not. Only a 10 percent chance of rain today in Paris.',
    ],
    [
      2,
      'Probably not — only a 20% chance of rain on Thursday',
      'Probably not. Only a 20 percent chance of rain on Thursday in Paris.',
    ],
    [3, "No — rain isn't expected on Friday (0%)", "No, rain isn't expected on Friday in Paris."],
    [
      4,
      "Possibly — there's a 45% chance of rain on Saturday",
      "Possibly. In Paris, there's a 45 percent chance of rain on Saturday.",
    ],
    [
      5,
      'Yes — snow is likely on Sunday (70%)',
      "Yes, snow is likely on Sunday in Paris. There's a 70 percent chance.",
    ],
  ])('rain verdict for day %s', async (day, verdict, speech) => {
    const { result, card } = await run({ day, question: 'rain' });
    expect(card.verdict).toBe(verdict);
    expect(result.speech).toBe(speech);
  });

  it('says "an" before 8, 11 and 18', async () => {
    const days = sampleForecast().days.map((entry, index) => ({
      ...entry,
      precipChance: [85, 11, 18, 8, 5, 40, 100][index] ?? 0,
    }));
    const forecast = sampleForecast({ days });
    const speech = async (day: number) =>
      (await run({ day, question: 'rain' }, { forecast })).result.speech;
    expect(await speech(0)).toContain('an 85 percent');
    expect(await speech(1)).toContain('an 11 percent');
    expect(await speech(2)).toContain('an 18 percent');
    expect(await speech(5)).toContain('a 40 percent');
    expect(await speech(6)).toContain('a 100 percent');
  });

  it('answers temperature questions', async () => {
    const today = await run({ day: 0, question: 'temperature' });
    expect(today.result.speech).toBe(
      "It's 18 degrees in Paris, feels like 17. Today's high is 21 and the low is 12.",
    );
    const tomorrow = await run({ day: 1, question: 'temperature' });
    expect(tomorrow.result.speech).toBe('Tomorrow in Paris, the high is 17 and the low is 11.');
    const saturday = await run({ day: 4, question: 'temperature' });
    expect(saturday.result.speech).toBe('Saturday in Paris, the high is 14 and the low is 9.');
  });

  it('describes a later day in general terms', async () => {
    const tomorrow = await run(general({ day: 1 }));
    expect(tomorrow.result.speech).toBe(
      'Tomorrow in Paris: rain, high 17, low 11, 80 percent chance of rain.',
    );
    const sunday = await run(general({ day: 5 }));
    expect(sunday.result.speech).toBe(
      'Sunday in Paris: snow, high 2, low minus 3, 70 percent chance of rain.',
    );
  });

  it('reads negative temperatures naturally', async () => {
    const base = sampleForecast();
    const forecast = sampleForecast({ current: { ...base.current, temp: -4, feelsLike: -8 } });
    const { result } = await run(general(), { forecast });
    expect(result.speech).toContain("It's minus 4 degrees and partly cloudy");
  });

  it('never points past the end of the forecast', async () => {
    const forecast = sampleForecast({ days: sampleForecast().days.slice(0, 3) });
    const { card } = await run(general({ day: 6 }), { forecast });
    expect(card.focusDay).toBe(2);
    const early = await run(general({ day: -2 }), { forecast });
    expect(early.card.focusDay).toBe(0);
  });

  it('fails loudly when the service returns no days', async () => {
    const forecast = sampleForecast({ days: [] });
    await expect(run(general(), { forecast })).rejects.toThrow('no days');
  });

  describe('when the lookup fails', () => {
    const failWith = async (code: WeatherErrorCode, slots: WeatherSlots = general()) => {
      const services = createFakeServices();
      services.weather = {
        forecast: () => Promise.reject(new WeatherError(code, `${code} failure`)),
      };
      const logger = createFakeLogger();
      const result = await weatherCommand.run(slots, runContext({ services, logger }));
      return { result, logger, card: result.cards[0] as StatusCard };
    };

    it('explains a missing connection', async () => {
      const { result, card, logger } = await failWith('no-network');
      expect(card).toMatchObject({ kind: 'status', tone: 'error', icon: 'wifi' });
      expect(result.speech).toBe("I couldn't reach the weather service. Check your connection.");
      expect(logger.warn).toHaveBeenCalled();
    });

    it('names the place it could not find', async () => {
      const { result, card } = await failWith('not-found', general({ place: 'xyzzy plugh' }));
      expect(card.title).toBe("I couldn't find a place called Xyzzy Plugh");
      expect(card.icon).toBe('weather');
      expect(result.speech).toBe("I couldn't find a place called Xyzzy Plugh.");
      const nameless = await failWith('not-found');
      expect(nameless.card.title).toBe("I couldn't find a place called That");
    });

    it('asks for a city when it cannot tell where you are', async () => {
      const { result, card } = await failWith('no-location');
      expect(card.title).toBe("I couldn't work out where you are");
      expect(result.speech).toContain('weather in Paris');
    });

    it('apologises for a garbled answer', async () => {
      const { result, card } = await failWith('bad-response');
      expect(card.tone).toBe('error');
      expect(result.speech).toBe(
        'The weather service had a problem. Please try again in a moment.',
      );
    });

    it('lets unexpected errors reach the runner', async () => {
      const services = createFakeServices();
      services.weather = { forecast: () => Promise.reject(new Error('boom')) };
      await expect(weatherCommand.run(general(), runContext({ services }))).rejects.toThrow('boom');
    });
  });
});

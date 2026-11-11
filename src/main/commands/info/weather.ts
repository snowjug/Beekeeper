import type { CommandResult, StatusCard, WeatherCard, WeatherDay } from '@shared/cards';
import { weekdayName } from '../lib/days';
import { titleCase } from '../lib/fuzzy';
import { statusCard } from '../lib/status';
import { parseWeatherFollowUp, parseWeatherPhrase } from '../lib/weather-phrases';
import type { WeatherQuestion } from '../lib/weather-phrases';
import { defineCommand, WeatherError } from '../types';
import type { ParseContext, RunContext, WeatherService } from '../types';

export interface WeatherSlots {
  /** Undefined = the default place. */
  place?: string;
  /** Days from today: 0 = today, 1 = tomorrow ... 6. */
  day: number;
  question: WeatherQuestion;
}

const COMMAND_ID = 'weather';
const SEARCH_URL = 'https://www.bing.com/search?q=';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isQuestion(value: unknown): value is WeatherQuestion {
  return value === 'general' || value === 'rain' || value === 'temperature';
}

/** What the previous turn asked, when that turn was a weather answer. */
function previousWeatherTurn(
  ctx: ParseContext,
): { place?: string; day?: number; question?: WeatherQuestion } | null {
  const last = ctx.turns[ctx.turns.length - 1];
  if (last?.commandId !== COMMAND_ID) return null;
  const place = last.context?.['place'];
  const focusDay = last.context?.['focusDay'];
  const question = isRecord(last.slots) ? last.slots['question'] : undefined;
  return {
    ...(typeof place === 'string' && place.length > 0 ? { place } : {}),
    ...(typeof focusDay === 'number' && focusDay >= 0 && focusDay <= 6 ? { day: focusDay } : {}),
    ...(isQuestion(question) ? { question } : {}),
  };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const cityOf = (place: string): string => place.split(',')[0]?.trim() ?? place;

function spokenDegrees(value: number): string {
  return value < 0 ? `minus ${Math.abs(value)}` : String(value);
}

function whenText(day: WeatherDay, focusDay: number): string {
  if (focusDay === 0) return 'today';
  if (focusDay === 1) return 'tomorrow';
  const name = weekdayName(day.date, 'long');
  return name.length > 0 ? `on ${name}` : day.label.toLowerCase();
}

function article(percent: number): 'a' | 'an' {
  return /^(?:8|11|18)/.test(String(percent)) ? 'an' : 'a';
}

function rainVerdict(
  day: WeatherDay,
  focusDay: number,
  city: string,
): { text: string; speech: string } {
  const noun = day.condition === 'snow' ? 'snow' : 'rain';
  const when = whenText(day, focusDay);
  const percent = day.precipChance;
  const chance = `${article(percent)} ${percent} percent chance`;
  if (percent >= 60) {
    return {
      text: `Yes — ${noun} is likely ${when} (${percent}%)`,
      speech: `Yes, ${noun} is likely ${when} in ${city}. There's ${chance}.`,
    };
  }
  if (percent >= 30) {
    return {
      text: `Possibly — there's a ${percent}% chance of ${noun} ${when}`,
      speech: `Possibly. In ${city}, there's ${chance} of ${noun} ${when}.`,
    };
  }
  if (percent >= 10) {
    return {
      text: `Probably not — only a ${percent}% chance of ${noun} ${when}`,
      speech: `Probably not. Only ${chance} of ${noun} ${when} in ${city}.`,
    };
  }
  return {
    text: `No — ${noun} isn't expected ${when} (${percent}%)`,
    speech: `No, ${noun} isn't expected ${when} in ${city}.`,
  };
}

function speechFor(
  current: WeatherCard['current'],
  day: WeatherDay,
  question: WeatherQuestion,
  focusDay: number,
  city: string,
): string {
  if (focusDay === 0) {
    if (question === 'temperature') {
      return `It's ${spokenDegrees(current.temp)} degrees in ${city}, feels like ${spokenDegrees(current.feelsLike)}. Today's high is ${spokenDegrees(day.tempMax)} and the low is ${spokenDegrees(day.tempMin)}.`;
    }
    return `It's ${spokenDegrees(current.temp)} degrees and ${current.summary.toLowerCase()} in ${city}. Today's high is ${spokenDegrees(day.tempMax)}.`;
  }

  const when = focusDay === 1 ? 'Tomorrow' : weekdayName(day.date, 'long') || day.label;
  if (question === 'temperature') {
    return `${when} in ${city}, the high is ${spokenDegrees(day.tempMax)} and the low is ${spokenDegrees(day.tempMin)}.`;
  }
  return `${when} in ${city}: ${day.summary.toLowerCase()}, high ${spokenDegrees(day.tempMax)}, low ${spokenDegrees(day.tempMin)}, ${day.precipChance} percent chance of rain.`;
}

function copyTextFor(card: Pick<WeatherCard, 'place' | 'units' | 'current' | 'days'>): string {
  const unit = card.units === 'imperial' ? 'F' : 'C';
  const today = card.days[0];
  const lines = [
    `Weather in ${card.place}: ${card.current.temp}°${unit}, ${card.current.summary.toLowerCase()} (feels like ${card.current.feelsLike}°${unit})`,
  ];
  if (today) {
    lines.push(
      `Today: ${today.summary.toLowerCase()}, high ${today.tempMax}°${unit}, low ${today.tempMin}°${unit}, ${today.precipChance}% chance of rain`,
    );
  }
  return lines.join('\n');
}

function errorResult(error: WeatherError, slots: WeatherSlots, ctx: RunContext): CommandResult {
  ctx.logger.warn('Weather lookup failed:', error.code, error.message);
  let title: string;
  let detail: string | undefined;
  let speech: string;
  let icon: StatusCard['icon'] = 'weather';
  switch (error.code) {
    case 'no-network':
      title = "I couldn't reach the weather service";
      detail = 'Check your connection.';
      speech = `${title}. ${detail}`;
      icon = 'wifi';
      break;
    case 'not-found':
      title = `I couldn't find a place called ${titleCase(slots.place ?? 'that')}`;
      detail = 'Try another spelling or a nearby city.';
      speech = `${title}.`;
      break;
    case 'no-location':
      title = "I couldn't work out where you are";
      detail = 'Ask for a city, like "weather in Paris", or set your city in Settings.';
      speech = `${title}. Ask for a city, like weather in Paris.`;
      break;
    case 'bad-response':
      title = 'The weather service had a problem';
      detail = 'Please try again in a moment.';
      speech = `${title}. ${detail}`;
      break;
  }
  const card = statusCard(ctx, { tone: 'error', icon, title, detail });
  return { cards: [card], speech };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const weatherCommand = defineCommand<WeatherSlots>({
  id: COMMAND_ID,
  number: 7,
  group: 'info',
  title: 'Weather',
  icon: 'weather',
  examples: [
    "What's the weather?",
    'Weather in Paris',
    'Will it rain tomorrow?',
    'Weather on Saturday',
  ],

  match(input, ctx) {
    const phrase = parseWeatherPhrase(input.text, ctx.now);
    if (phrase) {
      const base = phrase.confidence === 'high' ? 0.95 : 0.9;
      const slots: WeatherSlots = { day: phrase.day ?? 0, question: phrase.question };
      if (phrase.place !== undefined) slots.place = phrase.place;
      return { slots, score: phrase.corrected ? base - 0.1 : base };
    }

    const previous = previousWeatherTurn(ctx);
    if (!previous) return null;
    const followUp = parseWeatherFollowUp(input.text, ctx.now);
    if (!followUp) return null;
    const place = followUp.place ?? previous.place;
    const slots: WeatherSlots = {
      day: followUp.day ?? previous.day ?? 0,
      question: previous.question ?? 'general',
    };
    if (place !== undefined) slots.place = place;
    return { slots, score: followUp.corrected ? 0.8 : 0.9 };
  },

  async run(slots, ctx) {
    let forecast: Awaited<ReturnType<WeatherService['forecast']>>;
    try {
      forecast = await ctx.services.weather.forecast({
        place: slots.place,
        units: ctx.settings.units,
      });
    } catch (error) {
      if (error instanceof WeatherError) return errorResult(error, slots, ctx);
      throw error;
    }

    const focusDay = Math.min(Math.max(slots.day, 0), forecast.days.length - 1);
    const focus = forecast.days[focusDay];
    if (!focus) throw new Error('The forecast contained no days');
    const city = cityOf(forecast.place);
    const verdict = slots.question === 'rain' ? rainVerdict(focus, focusDay, city) : undefined;
    const searchUrl = `${SEARCH_URL}${encodeURIComponent(`weather ${forecast.place}`)}`;

    const card: WeatherCard = {
      ...forecast,
      id: ctx.newId(),
      createdAt: ctx.now.getTime(),
      focusDay,
      copyText: copyTextFor(forecast),
      openUrl: searchUrl,
    };
    if (verdict) card.verdict = verdict.text;

    return {
      cards: [card],
      speech: verdict?.speech ?? speechFor(forecast.current, focus, slots.question, focusDay, city),
      context: { ...(slots.place === undefined ? {} : { place: forecast.place }), focusDay },
    };
  },
});

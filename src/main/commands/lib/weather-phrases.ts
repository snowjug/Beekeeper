/**
 * Phrase understanding for the weather command: what is asked (general / rain / temperature),
 * for which place and for which day, plus short follow-ups such as "what about tomorrow".
 */
import { extractDay, WEEKDAYS } from './days';
import { correctTokens } from './fuzzy';

export type WeatherQuestion = 'general' | 'rain' | 'temperature';

interface WeatherPhrase {
  /** Undefined = the default place. */
  place?: string;
  /** Days from today (0-6). Undefined when the text names no day. */
  day?: number;
  question: WeatherQuestion;
  /** How unmistakable the phrase is ("weather" itself vs. "is it hot"). */
  confidence: 'high' | 'medium';
  /** True when a typo was repaired. */
  corrected: boolean;
}

interface WeatherFollowUp {
  place?: string;
  day?: number;
  corrected: boolean;
}

const VOCABULARY = [
  'weather',
  'forecast',
  'temperature',
  'tomorrow',
  'tonight',
  'today',
  'umbrella',
  'raining',
  ...WEEKDAYS,
];

const WEATHER_WORDS = new Set(['weather', 'forecast', 'forecasts']);
const WEATHER_SUFFIXES = new Set([
  'forecast',
  'forecasts',
  'report',
  'update',
  'conditions',
  'outlook',
]);
const RAIN_WORDS = new Set([
  'rain',
  'raining',
  'rainy',
  'rains',
  'umbrella',
  'drizzle',
  'drizzling',
  'shower',
  'showers',
  'snow',
  'snowing',
  'snowy',
  'storm',
  'storms',
  'stormy',
  'thunderstorm',
  'thunderstorms',
  'sleet',
  'hail',
]);
const TEMPERATURE_WORDS = new Set(['temperature', 'temperatures', 'temp', 'temps']);
const TEMPERATURE_ADJECTIVES = new Set([
  'hot',
  'cold',
  'warm',
  'cool',
  'chilly',
  'freezing',
  'boiling',
]);
const SKY_ADJECTIVES = new Set(['sunny', 'cloudy', 'windy', 'foggy', 'humid', 'overcast']);

/** Words that make "rain" a question rather than a topic. */
const RAIN_FRAME = new Set([
  'will',
  'is',
  'are',
  'does',
  'do',
  'should',
  'chance',
  'chances',
  'any',
  'going',
  'gonna',
  'need',
  'bring',
  'take',
]);
const ADJECTIVE_FRAME_START = new Set(['how', 'is', 'are', 'will']);

/** Function words that may surround the keywords of a weather question. */
const FILLERS = new Set([
  'what',
  'how',
  'is',
  'are',
  'will',
  'be',
  'it',
  'the',
  'a',
  'an',
  'going',
  'gonna',
  'to',
  'like',
  'there',
  'do',
  'does',
  'i',
  'need',
  'should',
  'bring',
  'take',
  'my',
  'me',
  'tell',
  'show',
  'give',
  'get',
  'check',
  'see',
  'pull',
  'up',
  'find',
  'out',
  'let',
  'know',
  'for',
  'of',
  'in',
  'at',
  'on',
  'this',
  'next',
  'current',
  'currently',
  'now',
  'and',
  'chance',
  'chances',
  'report',
  'update',
  'conditions',
  'outlook',
  'expected',
  'looking',
  'look',
  'about',
  'any',
  'kind',
  'much',
  'many',
  'again',
  'also',
  'too',
]);

const PLACE_PREPOSITIONS = new Set(['in', 'at', 'for', 'near', 'around']);
const DANGLING = new Set([
  'for',
  'on',
  'at',
  'in',
  'this',
  'next',
  'the',
  'a',
  'an',
  'of',
  'to',
  'and',
]);
const NOISE = /\b(?:at the moment|at present|right now|these days|outside|outdoors|out there)\b/g;

/** Places that mean "where I am": the default location. */
const DEFAULT_PLACES = new Set([
  'me',
  'here',
  'home',
  'area',
  'my area',
  'my location',
  'my current location',
  'current location',
  'my city',
  'my town',
  'my place',
  'my neighborhood',
  'my neighbourhood',
  'this area',
  'where i am',
  'where i live',
]);

/** Words that show a candidate is not a place name. */
const NOT_PLACE_WORDS = new Set([
  'week',
  'weekend',
  'month',
  'hour',
  'hours',
  'minute',
  'minutes',
  'morning',
  'afternoon',
  'evening',
  'night',
  'today',
  'tomorrow',
  'tonight',
  'yesterday',
  'day',
  'days',
  'trip',
  'vacation',
  'holiday',
  'holidays',
  'picnic',
  'party',
  'wedding',
  'game',
  'run',
  'walk',
  'drive',
  'flight',
  'commute',
  'app',
  'apps',
  'channel',
  'station',
  'widget',
  'radar',
  'map',
  'maps',
  'news',
  'weather',
  'forecast',
  'rain',
  'snow',
  'temperature',
  'that',
  'this',
  'it',
  'them',
  'you',
  'we',
  'i',
  'my',
  'our',
  'your',
  'his',
  'her',
  'their',
  'a',
  'an',
  'some',
  'any',
  'no',
  'not',
  'then',
  'so',
  'and',
  'or',
  'but',
  'what',
  'how',
  'why',
  'when',
  'who',
  'which',
  'with',
  'without',
  'be',
  'is',
  'are',
  'was',
  'will',
  'would',
  'could',
  'should',
  'can',
  'do',
  'does',
  'did',
  'have',
  'has',
]);

const FOLLOW_UP_LEAD = /^(?:(?:what|how) about|what if(?: it(?: is)?)?)\s+/;
const MAX_PLACE_WORDS = 5;
const MAX_UNMARKED_PLACE_WORDS = 3;

/** The place named by `raw`; undefined for "here"/"near me"; null when it is not a place. */
function cleanPlace(raw: string): string | null | undefined {
  const text = raw
    .replace(/^(?:the\s+)+/, '')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s+/g, ' ');
  if (DEFAULT_PLACES.has(text)) return undefined;
  if (text.length < 2 || text.length > 60) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'-]*$/u.test(text)) return null;
  const words = text.split(/[\s,]+/).filter((word) => word.length > 0);
  if (words.length > MAX_PLACE_WORDS) return null;
  return words.some((word) => NOT_PLACE_WORDS.has(word)) ? null : text;
}

function prepare(text: string): { text: string; corrected: boolean } {
  const spaced = text.replace(/\b(what|how|it|there|that)'?s\b/g, '$1').replace(NOISE, ' ');
  const tokens = spaced.split(' ').filter((token) => token.length > 0);
  const result = correctTokens(tokens, VOCABULARY);
  return { text: result.tokens.join(' '), corrected: result.corrected };
}

function stripDangling(words: string[]): void {
  while (words.length > 0 && DANGLING.has(words[words.length - 1] ?? '')) words.pop();
}

/** "weather forecast" and "weather report" are just "weather". */
function collapseWeatherSuffixes(words: readonly string[]): string[] {
  const result: string[] = [];
  for (const word of words) {
    if (result[result.length - 1] === 'weather' && WEATHER_SUFFIXES.has(word)) continue;
    result.push(word);
  }
  return result;
}

function isKeyword(word: string): boolean {
  return (
    WEATHER_WORDS.has(word) ||
    RAIN_WORDS.has(word) ||
    TEMPERATURE_WORDS.has(word) ||
    TEMPERATURE_ADJECTIVES.has(word) ||
    SKY_ADJECTIVES.has(word)
  );
}

/**
 * Understands "weather in paris", "will it rain tomorrow", "how hot is it", "do I need an
 * umbrella", "forecast for saturday" ... Returns null when the text is not a weather question.
 */
export function parseWeatherPhrase(text: string, now: Date): WeatherPhrase | null {
  const prepared = prepare(text);
  const extraction = extractDay(prepared.text, now);
  if (extraction.unreachable) return null;

  const words = extraction.rest.split(' ').filter((word) => word.length > 0);
  stripDangling(words);

  let place: string | undefined;
  let namedPlace = false;
  for (let index = words.length - 2; index >= 0; index -= 1) {
    if (!PLACE_PREPOSITIONS.has(words[index] ?? '')) continue;
    const cleaned = cleanPlace(words.slice(index + 1).join(' '));
    if (cleaned === null) return null;
    place = cleaned;
    namedPlace = true;
    words.length = index;
    stripDangling(words);
    break;
  }

  // "paris weather" / "weather paris": a few unknown words right next to "weather".
  const compact = collapseWeatherSuffixes(words);
  const unknown = compact.flatMap((word, index) =>
    FILLERS.has(word) || isKeyword(word) ? [] : [index],
  );
  if (unknown.length > 0) {
    const first = unknown[0] ?? 0;
    const last = unknown[unknown.length - 1] ?? 0;
    const contiguous = last - first + 1 === unknown.length;
    const nextToWeather = compact[first - 1] === 'weather' || compact[last + 1] === 'weather';
    if (namedPlace || !contiguous || !nextToWeather || unknown.length > MAX_UNMARKED_PLACE_WORDS) {
      return null;
    }
    const cleaned = cleanPlace(unknown.map((index) => compact[index] ?? '').join(' '));
    if (cleaned === null) return null;
    place = cleaned;
    namedPlace = true;
  }

  const has = (set: ReadonlySet<string>): boolean => compact.some((word) => set.has(word));
  const weather = has(WEATHER_WORDS);
  const rain = has(RAIN_WORDS);
  const temperature = has(TEMPERATURE_WORDS);
  const hot = has(TEMPERATURE_ADJECTIVES);
  const sky = has(SKY_ADJECTIVES);
  if (!weather && !rain && !temperature && !hot && !sky) return null;

  let confidence: WeatherPhrase['confidence'] = 'high';
  if (!weather && !temperature) {
    if (rain) {
      const anchored = extraction.day !== undefined || namedPlace;
      const framed = compact.some((word) => RAIN_FRAME.has(word));
      if (!framed && !anchored) return null;
      if (!framed) confidence = 'medium';
    } else {
      if (!ADJECTIVE_FRAME_START.has(compact[0] ?? '') || !compact.includes('it')) return null;
      confidence = 'medium';
    }
  }

  const question: WeatherQuestion = rain ? 'rain' : temperature || hot ? 'temperature' : 'general';
  const phrase: WeatherPhrase = { question, confidence, corrected: prepared.corrected };
  if (place !== undefined) phrase.place = place;
  if (extraction.day !== undefined) phrase.day = extraction.day;
  return phrase;
}

/**
 * Understands the short follow-ups that only make sense right after a weather answer:
 * "what about tomorrow", "and in london", "how about berlin", "what about paris tomorrow".
 */
export function parseWeatherFollowUp(text: string, now: Date): WeatherFollowUp | null {
  const prepared = prepare(text);
  const lead = FOLLOW_UP_LEAD.exec(prepared.text);
  const body = lead ? prepared.text.slice(lead[0].length) : prepared.text;

  const extraction = extractDay(body, now);
  if (extraction.unreachable) return null;
  const words = extraction.rest.split(' ').filter((word) => word.length > 0);
  stripDangling(words);

  if (words.length === 0) {
    return extraction.day === undefined
      ? null
      : { day: extraction.day, corrected: prepared.corrected };
  }
  let candidate: string;
  if (PLACE_PREPOSITIONS.has(words[0] ?? '')) candidate = words.slice(1).join(' ');
  else if (lead) candidate = words.join(' ');
  else return null;

  const place = cleanPlace(candidate);
  if (!place) return null;
  return extraction.day === undefined
    ? { place, corrected: prepared.corrected }
    : { place, day: extraction.day, corrected: prepared.corrected };
}

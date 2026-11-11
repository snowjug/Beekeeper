/** Weather words in Hindi: what the sky is doing now, and what it will do. */
import type { WeatherCondition } from '@shared/cards';

export interface SkyTerms {
  /** The condition as a phrase: "हल्की बारिश". */
  noun: string;
  /** What is happening now: "हल्की बारिश हो रही है". */
  present: string;
  /** What the forecast says: "हल्की बारिश होगी". */
  future: string;
}

const sky = (noun: string, present: string, future: string): SkyTerms => ({
  noun,
  present,
  future,
});

/** Open-Meteo's summaries (services/weather.ts), lower-cased. */
const BY_SUMMARY: Readonly<Record<string, SkyTerms>> = {
  'clear sky': sky('साफ़ आसमान', 'आसमान साफ़ है', 'आसमान साफ़ रहेगा'),
  'mainly clear': sky(
    'ज़्यादातर साफ़ आसमान',
    'आसमान ज़्यादातर साफ़ है',
    'आसमान ज़्यादातर साफ़ रहेगा',
  ),
  'partly cloudy': sky('आंशिक बादल', 'आसमान में कुछ बादल हैं', 'आसमान में कुछ बादल रहेंगे'),
  overcast: sky('घने बादल', 'आसमान में घने बादल छाए हैं', 'आसमान में घने बादल छाए रहेंगे'),
  fog: sky('कोहरा', 'कोहरा छाया हुआ है', 'कोहरा छाया रहेगा'),
  'freezing fog': sky(
    'जमा देने वाला कोहरा',
    'जमा देने वाला कोहरा छाया हुआ है',
    'जमा देने वाला कोहरा छाया रहेगा',
  ),
  'light drizzle': sky('हल्की फुहार', 'हल्की फुहार पड़ रही है', 'हल्की फुहार पड़ेगी'),
  drizzle: sky('फुहार', 'फुहार पड़ रही है', 'फुहार पड़ेगी'),
  'heavy drizzle': sky('तेज़ फुहार', 'तेज़ फुहार पड़ रही है', 'तेज़ फुहार पड़ेगी'),
  'light freezing drizzle': sky('ठंडी फुहार', 'ठंडी फुहार पड़ रही है', 'ठंडी फुहार पड़ेगी'),
  'freezing drizzle': sky('ठंडी फुहार', 'ठंडी फुहार पड़ रही है', 'ठंडी फुहार पड़ेगी'),
  'light rain': sky('हल्की बारिश', 'हल्की बारिश हो रही है', 'हल्की बारिश होगी'),
  rain: sky('बारिश', 'बारिश हो रही है', 'बारिश होगी'),
  'heavy rain': sky('तेज़ बारिश', 'तेज़ बारिश हो रही है', 'तेज़ बारिश होगी'),
  'light freezing rain': sky('ठंडी बारिश', 'ठंडी बारिश हो रही है', 'ठंडी बारिश होगी'),
  'freezing rain': sky('ठंडी बारिश', 'ठंडी बारिश हो रही है', 'ठंडी बारिश होगी'),
  'light snow': sky('हल्की बर्फ़बारी', 'हल्की बर्फ़बारी हो रही है', 'हल्की बर्फ़बारी होगी'),
  snow: sky('बर्फ़बारी', 'बर्फ़बारी हो रही है', 'बर्फ़बारी होगी'),
  'heavy snow': sky('भारी बर्फ़बारी', 'भारी बर्फ़बारी हो रही है', 'भारी बर्फ़बारी होगी'),
  'snow grains': sky('बर्फ़ के कण', 'बर्फ़ के कण गिर रहे हैं', 'बर्फ़ के कण गिरेंगे'),
  'light rain showers': sky('हल्की बौछारें', 'हल्की बौछारें पड़ रही हैं', 'हल्की बौछारें पड़ेंगी'),
  'rain showers': sky(
    'बारिश की बौछारें',
    'बारिश की बौछारें पड़ रही हैं',
    'बारिश की बौछारें पड़ेंगी',
  ),
  'heavy rain showers': sky('तेज़ बौछारें', 'तेज़ बौछारें पड़ रही हैं', 'तेज़ बौछारें पड़ेंगी'),
  'light snow showers': sky(
    'हल्की बर्फ़ की बौछारें',
    'हल्की बर्फ़ की बौछारें पड़ रही हैं',
    'हल्की बर्फ़ की बौछारें पड़ेंगी',
  ),
  'heavy snow showers': sky('भारी बर्फ़बारी', 'भारी बर्फ़बारी हो रही है', 'भारी बर्फ़बारी होगी'),
  thunderstorm: sky('आंधी-तूफ़ान', 'गरज के साथ बारिश हो रही है', 'गरज के साथ बारिश होगी'),
  'thunderstorm with hail': sky(
    'ओलों के साथ आंधी-तूफ़ान',
    'ओलों के साथ गरज-चमक हो रही है',
    'ओलों के साथ गरज-चमक होगी',
  ),
  'thunderstorm with heavy hail': sky(
    'भारी ओलों के साथ आंधी-तूफ़ान',
    'भारी ओलों के साथ गरज-चमक हो रही है',
    'भारी ओलों के साथ गरज-चमक होगी',
  ),
};

const BY_CONDITION: Readonly<Record<WeatherCondition, SkyTerms>> = {
  clear: sky('साफ़ आसमान', 'आसमान साफ़ है', 'आसमान साफ़ रहेगा'),
  'partly-cloudy': sky('आंशिक बादल', 'आसमान में कुछ बादल हैं', 'आसमान में कुछ बादल रहेंगे'),
  cloudy: sky('बादल', 'आसमान में बादल छाए हैं', 'आसमान में बादल छाए रहेंगे'),
  fog: sky('कोहरा', 'कोहरा छाया हुआ है', 'कोहरा छाया रहेगा'),
  drizzle: sky('फुहार', 'फुहार पड़ रही है', 'फुहार पड़ेगी'),
  rain: sky('बारिश', 'बारिश हो रही है', 'बारिश होगी'),
  snow: sky('बर्फ़बारी', 'बर्फ़बारी हो रही है', 'बर्फ़बारी होगी'),
  thunderstorm: sky('आंधी-तूफ़ान', 'गरज के साथ बारिश हो रही है', 'गरज के साथ बारिश होगी'),
};

/** The Hindi terms for a forecast summary; the condition decides when the summary is unknown. */
export function skyTerms(summary: string, condition: WeatherCondition): SkyTerms {
  return BY_SUMMARY[summary.toLowerCase()] ?? BY_CONDITION[condition];
}

/** The Hindi terms for a known forecast summary, or null. */
export function knownSkyTerms(summary: string): SkyTerms | null {
  return BY_SUMMARY[summary.toLowerCase()] ?? null;
}

export const SHORT_DAY_LABELS: Readonly<Record<string, string>> = { Today: 'आज', Tomorrow: 'कल' };

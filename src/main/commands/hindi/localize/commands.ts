/** Reply localisers for the commands whose answers carry data (time, weather, timers, notes ...). */
import type {
  BatteryCard,
  CalculationCard,
  Card,
  CommandResult,
  ConversionCard,
  GalleryCard,
  StatusCard,
  SystemInfoCard,
  TimeCard,
  TimerCard,
  WeatherCard,
  WeatherDay,
} from '@shared/cards';
import { GALLERY_COMMANDS, GALLERY_GROUPS } from './gallery';
import { localizeBriefing } from './briefing';
import {
  clockHindi,
  dateFromEnglish,
  degrees,
  durationHindi,
  parseTwelveHour,
  quantityHindi,
  remainingHindi,
  weekdayFromEnglish,
  weekdayHindi,
  whenFromEnglish,
  whenHindi,
} from './hi';
import { SHORT_DAY_LABELS, skyTerms } from './weatherTerms';

export interface LocalizeContext {
  commandId: string | null;
  locale: 'en' | 'hi';
  /** What the command matched (its slots): lets replies say what was asked. */
  slots?: unknown;
  /** The time the command ran at; defaults to the current time. */
  now?: Date;
}

type Localizer = (result: CommandResult, context: LocalizeContext) => CommandResult | null;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function withSpeech(result: CommandResult, speech: string, cards: Card[]): CommandResult {
  return { ...result, cards, speech };
}

function replaceCard(result: CommandResult, original: Card, replacement: Card): Card[] {
  return result.cards.map((card) => (card === original ? replacement : card));
}

function titleWords(text: string): string {
  return text.replace(/(^|[\s-])(\p{L})/gu, (_all, separator: string, letter: string) => {
    return `${separator}${letter.toUpperCase()}`;
  });
}

const cityOf = (place: string): string => place.split(',')[0]?.trim() ?? place;

// ---------------------------------------------------------------------------
// Time and date
// ---------------------------------------------------------------------------

export const localizeTime: Localizer = (result, context) => {
  const card = result.cards.find((candidate): candidate is TimeCard => candidate.kind === 'time');
  if (card === undefined) return null;
  const slotPlace = record(context.slots)['place'];
  const place =
    typeof slotPlace === 'string'
      ? titleWords(slotPlace)
      : /^.+? in (.+)$/.exec(card.copyText ?? '')?.[1];
  const where = place === undefined ? '' : `${place} में `;
  const time = parseTwelveHour(card.timeText);
  const clock = time === null ? card.timeText : clockHindi(time.hour, time.minute);
  const date = dateFromEnglish(card.dateText);
  const weekday = weekdayFromEnglish(card.weekday);
  const oneOClock = time !== null && time.minute === 0 && time.hour % 12 === 1;
  const timeSpeech = oneOClock
    ? `${where}अभी ${clock.replace(/ बजे$/, ' बजा')} है।`
    : `${where}अभी ${clock} हैं।`;

  const speech = {
    time: timeSpeech,
    date: `${where}आज ${date} है।`,
    day: `${where}आज ${weekday} है।`,
  }[card.focus];
  const shown = { time: card.timeText, date, day: weekday }[card.focus];
  const localized: TimeCard = {
    ...card,
    dateText: date,
    weekday,
    copyText: place === undefined ? shown : `${shown} (${place})`,
  };
  return withSpeech(result, speech, replaceCard(result, card, localized));
};

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

function weekdayOfDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (match === null) return '';
  const index = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
  return weekdayHindi(index);
}

function whenOfDay(focusDay: number, day: WeatherDay): string {
  if (focusDay === 0) return 'आज';
  if (focusDay === 1) return 'कल';
  const name = weekdayOfDate(day.date);
  return name === '' ? day.label : `${name} को`;
}

function rainVerdict(
  day: WeatherDay,
  when: string,
  city: string,
): { text: string; speech: string } {
  const noun = day.condition === 'snow' ? 'बर्फ़बारी' : 'बारिश';
  const percent = day.precipChance;
  if (percent >= 60) {
    return {
      text: `हाँ — ${when} ${noun} की संभावना है (${percent}%)`,
      speech: `हाँ, ${when} ${city} में ${noun} की संभावना है। संभावना ${percent} प्रतिशत है।`,
    };
  }
  if (percent >= 30) {
    return {
      text: `हो सकता है — ${when} ${noun} की ${percent}% संभावना है`,
      speech: `हो सकता है। ${city} में ${when} ${noun} की ${percent} प्रतिशत संभावना है।`,
    };
  }
  if (percent >= 10) {
    return {
      text: `शायद नहीं — ${when} ${noun} की सिर्फ़ ${percent}% संभावना है`,
      speech: `शायद नहीं। ${city} में ${when} ${noun} की संभावना सिर्फ़ ${percent} प्रतिशत है।`,
    };
  }
  return {
    text: `नहीं — ${when} ${noun} की संभावना नहीं है (${percent}%)`,
    speech: `नहीं, ${when} ${city} में ${noun} की संभावना नहीं है।`,
  };
}

export const localizeWeather: Localizer = (result, context) => {
  const card = result.cards.find(
    (candidate): candidate is WeatherCard => candidate.kind === 'weather',
  );
  if (card === undefined) return null;
  const asked = record(context.slots)['question'];
  const question =
    asked === 'rain' || asked === 'temperature' || asked === 'general'
      ? asked
      : card.verdict === undefined
        ? 'general'
        : 'rain';
  const city = cityOf(card.place);
  const unit = card.units === 'imperial' ? 'F' : 'C';
  const day = card.days[card.focusDay] ?? card.days[0];
  const now = skyTerms(card.current.summary, card.current.condition);
  const forecast = day === undefined ? now : skyTerms(day.summary, day.condition);
  const when = day === undefined ? 'आज' : whenOfDay(card.focusDay, day);
  const verdict = day === undefined ? undefined : rainVerdict(day, when, city);

  let speech: string;
  if (question === 'rain' && verdict !== undefined) {
    speech = verdict.speech;
  } else if (day === undefined) {
    speech = `${city} में अभी तापमान ${degrees(card.current.temp)} डिग्री है।`;
  } else if (card.focusDay === 0) {
    speech =
      question === 'temperature'
        ? `${city} में अभी ${degrees(card.current.temp)} डिग्री है, महसूस ${degrees(card.current.feelsLike)} डिग्री हो रहा है। आज अधिकतम ${degrees(day.tempMax)} डिग्री और न्यूनतम ${degrees(day.tempMin)} डिग्री रहेगा।`
        : `${city} में अभी तापमान ${degrees(card.current.temp)} डिग्री है और ${now.present}। आज अधिकतम तापमान ${degrees(day.tempMax)} डिग्री रहेगा।`;
  } else {
    speech =
      question === 'temperature'
        ? `${when} ${city} में अधिकतम तापमान ${degrees(day.tempMax)} डिग्री और न्यूनतम ${degrees(day.tempMin)} डिग्री रहेगा।`
        : `${when} ${city} में ${forecast.future}। अधिकतम तापमान ${degrees(day.tempMax)} डिग्री, न्यूनतम ${degrees(day.tempMin)} डिग्री और बारिश की संभावना ${day.precipChance} प्रतिशत है।`;
  }

  const today = card.days[0];
  const todayTerms = today === undefined ? now : skyTerms(today.summary, today.condition);
  const lines = [
    `${card.place} का मौसम: ${card.current.temp}°${unit}, ${now.noun} (महसूस ${card.current.feelsLike}°${unit})`,
  ];
  if (today !== undefined) {
    lines.push(
      `आज: ${todayTerms.noun}, अधिकतम ${today.tempMax}°${unit}, न्यूनतम ${today.tempMin}°${unit}, बारिश की संभावना ${today.precipChance}%`,
    );
  }
  const localized: WeatherCard = {
    ...card,
    current: { ...card.current, summary: now.noun },
    days: card.days.map((entry) => ({
      ...entry,
      label: SHORT_DAY_LABELS[entry.label] ?? weekdayFromEnglish(entry.label, true),
      summary: skyTerms(entry.summary, entry.condition).noun,
    })),
    copyText: lines.join('\n'),
  };
  if (card.verdict !== undefined && verdict !== undefined) localized.verdict = verdict.text;
  return withSpeech(result, speech, replaceCard(result, card, localized));
};

// ---------------------------------------------------------------------------
// Battery and system information
// ---------------------------------------------------------------------------

export const localizeBattery: Localizer = (result, context) => {
  const card = result.cards.find(
    (candidate): candidate is BatteryCard => candidate.kind === 'battery',
  );
  if (card === undefined) return null;
  if (!card.hasBattery || card.percent === undefined) {
    const localized: BatteryCard = { ...card, copyText: 'इस पीसी में बैटरी नहीं है' };
    return withSpeech(
      result,
      'इस पीसी में बैटरी नहीं है। यह एसी पावर पर चल रहा है।',
      replaceCard(result, card, localized),
    );
  }
  const percent = card.percent;
  const state = card.charging ? 'चार्ज हो रही है' : card.onAc ? 'प्लग इन है' : 'बैटरी पर';
  let speech: string;
  if (record(context.slots)['focus'] === 'charging') {
    if (card.charging) speech = `हाँ, आपकी बैटरी चार्ज हो रही है। यह ${percent} प्रतिशत है।`;
    else if (card.onAc) {
      speech = `नहीं, पीसी प्लग इन है लेकिन बैटरी चार्ज नहीं हो रही। बैटरी ${percent} प्रतिशत है।`;
    } else speech = `नहीं, आपका पीसी बैटरी पावर पर चल रहा है और बैटरी ${percent} प्रतिशत है।`;
  } else {
    const status = card.charging ? ' और चार्ज हो रही है' : card.onAc ? ' और प्लग इन है' : '';
    const left =
      !card.onAc && card.minutesRemaining !== undefined && card.minutesRemaining > 0
        ? `, लगभग ${durationHindi(card.minutesRemaining * 60_000)} बचे हैं`
        : '';
    speech = `आपकी बैटरी ${percent} प्रतिशत है${status}${left}।`;
  }
  const localized: BatteryCard = { ...card, copyText: `बैटरी: ${percent}% (${state})` };
  return withSpeech(result, speech, replaceCard(result, card, localized));
};

function bytesText(bytes: number): string {
  const gib = 1024 ** 3;
  const format = (value: number, digits: number): string => String(Number(value.toFixed(digits)));
  if (bytes >= 1024 * gib) return `${format(bytes / (1024 * gib), 1)} TB`;
  if (bytes >= gib) return `${format(bytes / gib, 1)} GB`;
  return `${format(bytes / 1024 ** 2, 0)} MB`;
}

export const localizeSystemInfo: Localizer = (result, context) => {
  const card = result.cards.find(
    (candidate): candidate is SystemInfoCard => candidate.kind === 'sysinfo',
  );
  if (card === undefined) return null;
  const { cpu, memory, disk } = card;
  const uptime = durationHindi(card.uptimeSeconds * 1000);
  const percent = (value: number): number => Math.round(value);
  const focus = record(context.slots)['focus'];
  let speech: string;
  switch (focus) {
    case 'ram':
      speech = `आप ${bytesText(memory.totalBytes)} में से ${bytesText(memory.usedBytes)} मेमोरी इस्तेमाल कर रहे हैं, यानी लगभग ${percent(memory.usagePercent)} प्रतिशत।`;
      break;
    case 'cpu':
      speech = `आपके ${cpu.cores}-कोर ${cpu.name} पर सीपीयू का उपयोग ${percent(cpu.usagePercent)} प्रतिशत है।`;
      break;
    case 'disk':
      speech = `ड्राइव ${disk.drive} पर ${bytesText(disk.totalBytes)} में से ${bytesText(disk.freeBytes)} खाली है।`;
      break;
    case 'uptime':
      speech = `आपका पीसी ${uptime} से चालू है।`;
      break;
    default:
      speech = `${card.os}। सीपीयू ${percent(cpu.usagePercent)} प्रतिशत, मेमोरी ${percent(memory.usagePercent)} प्रतिशत इस्तेमाल में, ड्राइव ${disk.drive} पर ${bytesText(disk.freeBytes)} खाली। पीसी ${uptime} से चालू है।`;
  }
  const copyText = [
    `ओएस: ${card.os}`,
    `सीपीयू: ${cpu.name} (${cpu.cores} कोर), ${percent(cpu.usagePercent)}% उपयोग में`,
    `मेमोरी: ${bytesText(memory.totalBytes)} में से ${bytesText(memory.usedBytes)} उपयोग में (${percent(memory.usagePercent)}%)`,
    `डिस्क ${disk.drive}: ${bytesText(disk.totalBytes)} में से ${bytesText(disk.freeBytes)} खाली`,
    `चालू रहने का समय: ${uptime}`,
  ].join('\n');
  const localized: SystemInfoCard = { ...card, copyText };
  return withSpeech(result, speech, replaceCard(result, card, localized));
};

// ---------------------------------------------------------------------------
// Calculator and converter
// ---------------------------------------------------------------------------

const MATH_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ × /g, ' गुणा '],
  [/ ÷ /g, ' भाग '],
  [/ \+ /g, ' जमा '],
  [/ − /g, ' घटा '],
  [/−/g, 'माइनस '],
  [/\^/g, ' की घात '],
  [/%/g, ' प्रतिशत'],
  [/²/g, ' का वर्ग'],
  [/³/g, ' का घन'],
  [/°/g, ' डिग्री'],
  [/π/g, 'पाई'],
];

/** "15% of 2400" -> "2400 का 15 प्रतिशत", "5 × 6" -> "5 गुणा 6", "sqrt(144)" -> "144 का वर्गमूल". */
export function speakExpression(expression: string): string {
  const percentOf = /^(\S+)% of (\S+)$/.exec(expression);
  if (percentOf !== null) return `${percentOf[2] ?? ''} का ${percentOf[1] ?? ''} प्रतिशत`;
  const roots: ReadonlyArray<readonly [string, string]> = [
    ['sqrt', 'का वर्गमूल'],
    ['cbrt', 'का घनमूल'],
    ['abs', 'का निरपेक्ष मान'],
  ];
  for (const [name, words] of roots) {
    const call = new RegExp(`^${name}\\((.+)\\)$`).exec(expression);
    if (call !== null) return `${call[1] ?? ''} ${words}`;
  }
  let spoken = expression.replace(/ of /g, ' का ');
  for (const [pattern, replacement] of MATH_WORDS) spoken = spoken.replace(pattern, replacement);
  return spoken.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const localizeCalculation: Localizer = (result) => {
  const card = result.cards.find(
    (candidate): candidate is CalculationCard => candidate.kind === 'calc',
  );
  if (card === undefined) return null;
  const spoken = speakExpression(card.expression);
  const linking = / का /.test(spoken) ? '' : ' बराबर';
  const speech = `${spoken}${linking} ${card.resultText} है।`;
  return withSpeech(result, speech, result.cards);
};

const SPOKEN_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/°C\b/g, ' डिग्री सेल्सियस'],
  [/°F\b/g, ' डिग्री फ़ारेनहाइट'],
  [/(\d)K\b/g, '$1 केल्विन'],
  [/\bKiB\b/g, 'किबिबाइट'],
  [/\bMiB\b/g, 'मेबिबाइट'],
  [/\bGiB\b/g, 'गिबिबाइट'],
  [/\bTiB\b/g, 'टेबिबाइट'],
  [/\bKB\b/g, 'किलोबाइट'],
  [/\bMB\b/g, 'मेगाबाइट'],
  [/\bGB\b/g, 'गीगाबाइट'],
  [/\bTB\b/g, 'टेराबाइट'],
  [/\bPB\b/g, 'पेटाबाइट'],
  [/\bKbit\b/g, 'किलोबिट'],
  [/\bMbit\b/g, 'मेगाबिट'],
  [/\bGbit\b/g, 'गीगाबिट'],
];

function spokenQuantity(text: string): string {
  let spoken = quantityHindi(text);
  for (const [pattern, replacement] of SPOKEN_SYMBOLS) {
    spoken = spoken.replace(pattern, replacement);
  }
  return spoken;
}

export const localizeConversion: Localizer = (result) => {
  const card = result.cards.find(
    (candidate): candidate is ConversionCard => candidate.kind === 'conversion',
  );
  if (card === undefined) return null;
  const localized: ConversionCard = {
    ...card,
    fromText: quantityHindi(card.fromText),
    toText: quantityHindi(card.toText),
    ...(card.copyText === undefined ? {} : { copyText: quantityHindi(card.copyText) }),
  };
  const speech = `${spokenQuantity(card.fromText)} ${spokenQuantity(card.toText)} के बराबर है।`;
  return withSpeech(result, speech, replaceCard(result, card, localized));
};

// ---------------------------------------------------------------------------
// Timers, alarms and reminders
// ---------------------------------------------------------------------------

const DEFAULT_LABELS: Readonly<Record<string, string>> = { Timer: 'टाइमर', Alarm: 'अलार्म' };

function localizeTimerCard(card: TimerCard): TimerCard {
  const label = DEFAULT_LABELS[card.label];
  return label === undefined ? card : { ...card, label };
}

function startedTimer(card: TimerCard, slots: Record<string, unknown>): string {
  const requested = slots['durationMs'];
  const duration = durationHindi(typeof requested === 'number' ? requested : card.durationMs);
  const named = typeof slots['label'] === 'string' ? slots['label'] : card.label;
  return named === 'Timer'
    ? `ठीक है, ${duration} का टाइमर शुरू कर दिया।`
    : `ठीक है, ${named} के लिए ${duration} का टाइमर शुरू कर दिया।`;
}

function describeTimers(cards: readonly TimerCard[], now: Date): string {
  const [first] = cards;
  if (first === undefined) return '';
  const left = remainingHindi(first.endsAt - now.getTime());
  const when = whenHindi(new Date(first.endsAt), now);
  if (cards.length === 1) {
    switch (first.timerType) {
      case 'timer':
        return first.label === 'Timer'
          ? `आपके टाइमर में ${left} बचे हैं।`
          : `${first.label} में ${left} बचे हैं।`;
      case 'alarm':
        return `आपका अलार्म ${when} के लिए सेट है।`;
      case 'reminder':
        return `रिमाइंडर ${when}: ${first.label}।`;
    }
  }
  switch (first.timerType) {
    case 'timer':
      return `आपके ${cards.length} टाइमर चल रहे हैं। अगले टाइमर में ${left} बचे हैं।`;
    case 'alarm':
      return `आपके ${cards.length} अलार्म सेट हैं। अगला अलार्म ${when} के लिए है।`;
    case 'reminder':
      return `आपके ${cards.length} रिमाइंडर हैं। अगला ${when}: ${first.label}।`;
  }
}

const KIND_NAMES: Readonly<Record<TimerCard['timerType'], string>> = {
  timer: 'टाइमर',
  alarm: 'अलार्म',
  reminder: 'रिमाइंडर',
};

function retitled(card: StatusCard, title: string): StatusCard {
  return { ...card, title };
}

function scheduledStatus(result: CommandResult, context: LocalizeContext): CommandResult | null {
  const [card] = result.cards;
  if (card?.kind !== 'status') return null;
  const now = context.now ?? new Date();
  const slots = record(context.slots);
  const at = slots['at'];

  const alarm = /^Alarm set for (.+)$/.exec(card.title);
  if (alarm !== null) {
    const when =
      typeof at === 'number' ? whenHindi(new Date(at), now) : whenFromEnglish(alarm[1] ?? '');
    if (when === null) return null;
    const title = `अलार्म ${when} के लिए सेट हो गया`;
    return withSpeech(result, `${title}।`, [retitled(card, title), ...result.cards.slice(1)]);
  }

  const reminder = /^I'll remind you (?:at )?(.+?) (?:to|about|that) (.+)$/.exec(card.title);
  if (reminder !== null) {
    const when =
      typeof at === 'number' ? whenHindi(new Date(at), now) : whenFromEnglish(reminder[1] ?? '');
    if (when === null) return null;
    const task = typeof slots['text'] === 'string' ? slots['text'] : (reminder[2] ?? '');
    const title = `ठीक है, मैं आपको ${when} याद दिलाऊँगा: ${task}`;
    return withSpeech(result, `${title}।`, [retitled(card, title), ...result.cards.slice(1)]);
  }
  return null;
}

export const localizeScheduled: Localizer = (result, context) => {
  const now = context.now ?? new Date();
  const timerCards = result.cards.filter((card): card is TimerCard => card.kind === 'timer');
  const [first] = timerCards;
  if (first === undefined) return scheduledStatus(result, context);

  const cards = result.cards.map((card) =>
    card.kind === 'timer' ? localizeTimerCard(card) : card,
  );
  if (first.state === 'cancelled') {
    return withSpeech(result, `${KIND_NAMES[first.timerType]} रद्द कर दिया।`, cards);
  }
  if (/^Timer set for/.test(result.speech ?? '')) {
    return withSpeech(result, startedTimer(first, record(context.slots)), cards);
  }
  return withSpeech(result, describeTimers(timerCards, now), cards);
};

// ---------------------------------------------------------------------------
// Help gallery
// ---------------------------------------------------------------------------

export const localizeGallery: Localizer = (result) => {
  const card = result.cards.find(
    (candidate): candidate is GalleryCard => candidate.kind === 'gallery',
  );
  if (card === undefined) return null;
  const localized: GalleryCard = {
    ...card,
    groups: card.groups.map((group) => ({
      title: GALLERY_GROUPS[group.title] ?? group.title,
      commands: group.commands.map((command) => {
        const hindi = GALLERY_COMMANDS[command.title];
        return hindi === undefined
          ? command
          : { ...command, title: hindi.title, examples: [...hindi.examples] };
      }),
    })),
  };
  return withSpeech(
    result,
    'मैं टाइमर, मौसम, नोट्स, ऐप खोलने, आवाज़ और ब्राइटनेस जैसे कई कामों में आपकी मदद कर सकता हूँ।',
    replaceCard(result, card, localized),
  );
};

export const LOCALIZERS: Readonly<Record<string, Localizer>> = {
  datetime: localizeTime,
  weather: localizeWeather,
  battery: localizeBattery,
  'system-info': localizeSystemInfo,
  calculate: localizeCalculation,
  convert: localizeConversion,
  timer: localizeScheduled,
  alarm: localizeScheduled,
  reminder: localizeScheduled,
  briefing: localizeBriefing,
  'settings-and-help': localizeGallery,
};

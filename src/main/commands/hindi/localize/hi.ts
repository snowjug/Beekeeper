/** Hindi building blocks for replies: durations, clock phrases, dates, units and weather terms. */

const WEEKDAYS = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const WEEKDAYS_SHORT = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
const MONTHS = [
  'जनवरी',
  'फ़रवरी',
  'मार्च',
  'अप्रैल',
  'मई',
  'जून',
  'जुलाई',
  'अगस्त',
  'सितंबर',
  'अक्टूबर',
  'नवंबर',
  'दिसंबर',
];
const ENGLISH_WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const ENGLISH_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export function weekdayHindi(index: number): string {
  return WEEKDAYS[((index % 7) + 7) % 7] ?? '';
}

/** "Tuesday" / "Tue" / "tuesday" -> "मंगलवार" (long) or "मंगल" (short); the input unchanged when unknown. */
export function weekdayFromEnglish(name: string, short = false): string {
  const lower = name.toLowerCase();
  const index = ENGLISH_WEEKDAYS.findIndex((day) => day === lower || day.slice(0, 3) === lower);
  if (index < 0) return name;
  return (short ? WEEKDAYS_SHORT[index] : WEEKDAYS[index]) ?? name;
}

export function monthFromEnglish(name: string): string {
  const lower = name.toLowerCase();
  const index = ENGLISH_MONTHS.findIndex((month) => month === lower || month.slice(0, 3) === lower);
  return index < 0 ? name : (MONTHS[index] ?? name);
}

/** "Tuesday, November 10, 2026" -> "मंगलवार, 10 नवंबर 2026". */
export function dateFromEnglish(text: string): string {
  const match = /^(\w+), (\w+) (\d{1,2}), (\d{4})$/.exec(text.trim());
  if (match === null) return text;
  const [, weekday = '', month = '', day = '', year = ''] = match;
  return `${weekdayFromEnglish(weekday)}, ${day} ${monthFromEnglish(month)} ${year}`;
}

export function degrees(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `माइनस ${Math.abs(rounded)}` : String(rounded);
}

/** Part of the day a clock hour (0-23) belongs to: सुबह, दोपहर, शाम, रात. */
export function periodOf(hour: number): string {
  if (hour >= 4 && hour < 12) return 'सुबह';
  if (hour >= 12 && hour < 16) return 'दोपहर';
  if (hour >= 16 && hour < 19) return 'शाम';
  return 'रात';
}

/** "सुबह 7 बजे", "दोपहर 3:42 बजे". */
export function clockHindi(hour24: number, minute: number): string {
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const time = minute === 0 ? String(hour) : `${hour}:${String(minute).padStart(2, '0')}`;
  return `${periodOf(hour24)} ${time} बजे`;
}

/** "3:30 PM" -> { hour: 15, minute: 30 }. */
export function parseTwelveHour(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(text.trim());
  if (match === null) return null;
  const hour12 = Number(match[1]) % 12;
  const pm = (match[3] ?? '').toUpperCase() === 'PM';
  return { hour: hour12 + (pm ? 12 : 0), minute: Number(match[2]) };
}

const DAY_MS = 86_400_000;

function calendarDays(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / DAY_MS);
}

/** When something happens, as Hindi: "आज शाम 6 बजे", "कल सुबह 7:30 बजे", "शुक्रवार को सुबह 9 बजे". */
export function whenHindi(date: Date, now: Date): string {
  const time = clockHindi(date.getHours(), date.getMinutes());
  const days = calendarDays(now, date);
  if (days === 0) return `आज ${time}`;
  if (days === 1) return `कल ${time}`;
  if (days === -1) return `बीते कल ${time}`;
  if (days > 1 && days < 7) return `${weekdayHindi(date.getDay())} को ${time}`;
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}${year} को ${time}`;
}

/**
 * The clock text of the English formatClock ("3:30 PM", "tomorrow at 9:00 AM", "Friday at 9:00 AM",
 * "Nov 25 at 9:00 AM") as Hindi, or null when it does not look like one.
 */
export function whenFromEnglish(text: string): string | null {
  const match = /^(?:(.+?) at )?(\d{1,2}:\d{2} [AP]M)$/.exec(text.trim());
  if (match === null) return null;
  const time = parseTwelveHour(match[2] ?? '');
  if (time === null) return null;
  const clock = clockHindi(time.hour, time.minute);
  const day = match[1];
  if (day === undefined) return `आज ${clock}`;
  const lower = day.toLowerCase();
  if (lower === 'tomorrow') return `कल ${clock}`;
  if (lower === 'yesterday') return `बीते कल ${clock}`;
  const weekday = ENGLISH_WEEKDAYS.find((name) => name === lower);
  if (weekday !== undefined) return `${weekdayFromEnglish(weekday)} को ${clock}`;
  const date = /^([A-Za-z]{3}) (\d{1,2})(?:, (\d{4}))?$/.exec(day);
  if (date === null) return null;
  const year = date[3] === undefined ? '' : ` ${date[3]}`;
  return `${date[2] ?? ''} ${monthFromEnglish(date[1] ?? '')}${year} को ${clock}`;
}

function unitWord(unit: string, count: number): string {
  switch (unit) {
    case 'day':
      return 'दिन';
    case 'hour':
      return count === 1 ? 'घंटा' : 'घंटे';
    case 'minute':
      return 'मिनट';
    default:
      return 'सेकंड';
  }
}

/** "1 hour 30 minutes" / "3 days and 4 hours" / "less than a minute" as Hindi. */
export function durationFromEnglish(text: string): string {
  if (/^less than a minute$/i.test(text.trim())) return 'एक मिनट से भी कम';
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?) (day|hour|minute|second)s?/g)].map((match) => {
    const count = Number(match[1]);
    return `${match[1] ?? ''} ${unitWord(match[2] ?? '', count)}`;
  });
  return parts.length === 0 ? text : parts.join(' ');
}

/** Milliseconds as Hindi: "5 मिनट", "1 घंटा 30 मिनट", "45 सेकंड". */
export function durationHindi(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  if (total === 0) return '0 सेकंड';
  const parts: Array<[number, string]> = [
    [Math.floor(total / 86_400), 'day'],
    [Math.floor((total % 86_400) / 3_600), 'hour'],
    [Math.floor((total % 3_600) / 60), 'minute'],
    [total % 60, 'second'],
  ];
  return parts
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value} ${unitWord(unit, value)}`)
    .join(' ');
}

/** Number of seconds as the countdown text "4:32". */
export function remainingHindi(ms: number): string {
  return durationHindi(Math.max(0, Math.ceil(ms / 1000) * 1000));
}

const UNIT_NAMES: ReadonlyArray<readonly [english: string, hindi: string]> = [
  ['nautical miles', 'समुद्री मील'],
  ['nautical mile', 'समुद्री मील'],
  ['short tons', 'शॉर्ट टन'],
  ['short ton', 'शॉर्ट टन'],
  ['degrees Celsius', 'डिग्री सेल्सियस'],
  ['degree Celsius', 'डिग्री सेल्सियस'],
  ['degrees Fahrenheit', 'डिग्री फ़ारेनहाइट'],
  ['degree Fahrenheit', 'डिग्री फ़ारेनहाइट'],
  ['kilometers', 'किलोमीटर'],
  ['kilometer', 'किलोमीटर'],
  ['millimeters', 'मिलीमीटर'],
  ['millimeter', 'मिलीमीटर'],
  ['centimeters', 'सेंटीमीटर'],
  ['centimeter', 'सेंटीमीटर'],
  ['meters', 'मीटर'],
  ['meter', 'मीटर'],
  ['miles', 'मील'],
  ['mile', 'मील'],
  ['inches', 'इंच'],
  ['inch', 'इंच'],
  ['feet', 'फुट'],
  ['foot', 'फुट'],
  ['yards', 'गज'],
  ['yard', 'गज'],
  ['milligrams', 'मिलीग्राम'],
  ['milligram', 'मिलीग्राम'],
  ['kilograms', 'किलोग्राम'],
  ['kilogram', 'किलोग्राम'],
  ['grams', 'ग्राम'],
  ['gram', 'ग्राम'],
  ['pounds', 'पाउंड'],
  ['pound', 'पाउंड'],
  ['ounces', 'औंस'],
  ['ounce', 'औंस'],
  ['stone', 'स्टोन'],
  ['tonnes', 'टन'],
  ['tonne', 'टन'],
  ['kelvin', 'केल्विन'],
  ['bytes', 'बाइट'],
  ['byte', 'बाइट'],
  ['bits', 'बिट'],
  ['bit', 'बिट'],
  ['kilobytes', 'किलोबाइट'],
  ['megabytes', 'मेगाबाइट'],
  ['gigabytes', 'गीगाबाइट'],
  ['terabytes', 'टेराबाइट'],
  ['petabytes', 'पेटाबाइट'],
];

/** "10 kilometers" -> "10 किलोमीटर"; symbols such as "100°F" or "2 GB" stay as they are. */
export function quantityHindi(text: string): string {
  for (const [english, hindi] of UNIT_NAMES) {
    if (new RegExp(`\\b${english}\\b`).test(text)) return text.replace(english, hindi);
  }
  return text;
}

/** Unit names in `convert` error messages ("kilometers" -> "किलोमीटर"). */
export function unitHindi(plural: string): string {
  return UNIT_NAMES.find(([english]) => english === plural)?.[1] ?? plural;
}

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  length: 'लंबाई',
  weight: 'वज़न',
  temperature: 'तापमान',
  'data size': 'डेटा साइज़',
};

export function categoryHindi(name: string): string {
  return CATEGORY_NAMES[name] ?? name;
}

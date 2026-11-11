/** City / country / abbreviation -> IANA time zone, for "what time is it in Tokyo". */

interface ZoneMatch {
  /** IANA zone, e.g. "Asia/Tokyo". */
  zone: string;
  /** Name to show and speak, e.g. "Tokyo". */
  label: string;
}

type Entry = readonly [label: string, zone: string, ...aliases: string[]];

const ENTRIES: readonly Entry[] = [
  // North America
  ['New York', 'America/New_York', 'nyc', 'new york city'],
  ['Boston', 'America/New_York'],
  ['Washington', 'America/New_York', 'washington dc', 'dc'],
  ['Miami', 'America/New_York'],
  ['Atlanta', 'America/New_York'],
  ['Philadelphia', 'America/New_York'],
  ['Detroit', 'America/New_York'],
  ['Eastern Time', 'America/New_York', 'est', 'edt', 'et', 'eastern', 'eastern standard time'],
  ['Chicago', 'America/Chicago'],
  ['Dallas', 'America/Chicago'],
  ['Houston', 'America/Chicago'],
  ['Austin', 'America/Chicago'],
  ['San Antonio', 'America/Chicago'],
  ['New Orleans', 'America/Chicago'],
  ['Minneapolis', 'America/Chicago'],
  ['Kansas City', 'America/Chicago'],
  ['Nashville', 'America/Chicago'],
  ['Central Time', 'America/Chicago', 'cst', 'cdt', 'ct', 'central', 'central standard time'],
  ['Denver', 'America/Denver'],
  ['Salt Lake City', 'America/Denver'],
  ['Mountain Time', 'America/Denver', 'mst', 'mdt', 'mt', 'mountain', 'mountain standard time'],
  ['Phoenix', 'America/Phoenix'],
  ['Los Angeles', 'America/Los_Angeles', 'la'],
  ['San Francisco', 'America/Los_Angeles', 'sf'],
  ['San Diego', 'America/Los_Angeles'],
  ['San Jose', 'America/Los_Angeles'],
  ['Seattle', 'America/Los_Angeles'],
  ['Portland', 'America/Los_Angeles'],
  ['Las Vegas', 'America/Los_Angeles'],
  ['California', 'America/Los_Angeles'],
  ['Pacific Time', 'America/Los_Angeles', 'pst', 'pdt', 'pt', 'pacific', 'pacific standard time'],
  ['Anchorage', 'America/Anchorage', 'alaska'],
  ['Honolulu', 'Pacific/Honolulu', 'hawaii', 'hst'],
  ['Toronto', 'America/Toronto'],
  ['Ottawa', 'America/Toronto'],
  ['Montreal', 'America/Toronto'],
  ['Vancouver', 'America/Vancouver'],
  ['Calgary', 'America/Edmonton'],
  ['Edmonton', 'America/Edmonton'],
  ['Winnipeg', 'America/Winnipeg'],
  ['Halifax', 'America/Halifax'],
  ['Mexico City', 'America/Mexico_City', 'mexico'],
  ['Cancun', 'America/Cancun'],
  ['Havana', 'America/Havana', 'cuba'],
  ['Panama City', 'America/Panama', 'panama'],
  ['Kingston', 'America/Jamaica', 'jamaica'],
  ['San Juan', 'America/Puerto_Rico', 'puerto rico'],
  // South America
  ['São Paulo', 'America/Sao_Paulo'],
  ['Rio de Janeiro', 'America/Sao_Paulo', 'rio'],
  ['Brasília', 'America/Sao_Paulo', 'brazil'],
  ['Buenos Aires', 'America/Argentina/Buenos_Aires', 'argentina'],
  ['Santiago', 'America/Santiago', 'chile'],
  ['Bogotá', 'America/Bogota', 'colombia'],
  ['Lima', 'America/Lima', 'peru'],
  ['Caracas', 'America/Caracas', 'venezuela'],
  ['Quito', 'America/Guayaquil', 'ecuador'],
  ['La Paz', 'America/La_Paz', 'bolivia'],
  ['Montevideo', 'America/Montevideo', 'uruguay'],
  // Europe
  ['London', 'Europe/London', 'uk', 'united kingdom', 'england', 'britain', 'great britain'],
  ['Manchester', 'Europe/London'],
  ['Edinburgh', 'Europe/London', 'scotland'],
  ['Glasgow', 'Europe/London'],
  ['British Time', 'Europe/London', 'bst', 'british summer time'],
  ['Dublin', 'Europe/Dublin', 'ireland'],
  ['Lisbon', 'Europe/Lisbon', 'portugal'],
  ['Madrid', 'Europe/Madrid', 'spain'],
  ['Barcelona', 'Europe/Madrid'],
  ['Paris', 'Europe/Paris', 'france'],
  ['Lyon', 'Europe/Paris'],
  ['Marseille', 'Europe/Paris'],
  ['Berlin', 'Europe/Berlin', 'germany'],
  ['Munich', 'Europe/Berlin'],
  ['Frankfurt', 'Europe/Berlin'],
  ['Hamburg', 'Europe/Berlin'],
  ['Amsterdam', 'Europe/Amsterdam', 'netherlands', 'holland'],
  ['Brussels', 'Europe/Brussels', 'belgium'],
  ['Luxembourg', 'Europe/Luxembourg'],
  ['Zurich', 'Europe/Zurich', 'switzerland'],
  ['Geneva', 'Europe/Zurich'],
  ['Vienna', 'Europe/Vienna', 'austria'],
  ['Rome', 'Europe/Rome', 'italy'],
  ['Milan', 'Europe/Rome'],
  ['Athens', 'Europe/Athens', 'greece'],
  ['Helsinki', 'Europe/Helsinki', 'finland'],
  ['Stockholm', 'Europe/Stockholm', 'sweden'],
  ['Oslo', 'Europe/Oslo', 'norway'],
  ['Copenhagen', 'Europe/Copenhagen', 'denmark'],
  ['Warsaw', 'Europe/Warsaw', 'poland'],
  ['Prague', 'Europe/Prague', 'czech republic', 'czechia'],
  ['Budapest', 'Europe/Budapest', 'hungary'],
  ['Bucharest', 'Europe/Bucharest', 'romania'],
  ['Sofia', 'Europe/Sofia', 'bulgaria'],
  ['Belgrade', 'Europe/Belgrade', 'serbia'],
  ['Zagreb', 'Europe/Zagreb', 'croatia'],
  ['Kyiv', 'Europe/Kyiv', 'kiev', 'ukraine'],
  ['Moscow', 'Europe/Moscow', 'russia'],
  ['Istanbul', 'Europe/Istanbul', 'turkey', 'turkiye'],
  ['Reykjavik', 'Atlantic/Reykjavik', 'iceland'],
  ['Central European Time', 'Europe/Paris', 'cet', 'cest'],
  // Africa
  ['Cairo', 'Africa/Cairo', 'egypt'],
  ['Lagos', 'Africa/Lagos', 'nigeria'],
  ['Nairobi', 'Africa/Nairobi', 'kenya'],
  ['Johannesburg', 'Africa/Johannesburg', 'south africa'],
  ['Cape Town', 'Africa/Johannesburg'],
  ['Casablanca', 'Africa/Casablanca', 'morocco'],
  ['Accra', 'Africa/Accra', 'ghana'],
  ['Addis Ababa', 'Africa/Addis_Ababa', 'ethiopia'],
  ['Algiers', 'Africa/Algiers', 'algeria'],
  ['Tunis', 'Africa/Tunis', 'tunisia'],
  ['Dar es Salaam', 'Africa/Dar_es_Salaam', 'tanzania'],
  ['Kampala', 'Africa/Kampala', 'uganda'],
  // Middle East
  ['Dubai', 'Asia/Dubai', 'uae', 'united arab emirates'],
  ['Abu Dhabi', 'Asia/Dubai'],
  ['Doha', 'Asia/Qatar', 'qatar'],
  ['Riyadh', 'Asia/Riyadh', 'saudi arabia'],
  ['Jeddah', 'Asia/Riyadh'],
  ['Kuwait City', 'Asia/Kuwait', 'kuwait'],
  ['Tehran', 'Asia/Tehran', 'iran'],
  ['Baghdad', 'Asia/Baghdad', 'iraq'],
  ['Jerusalem', 'Asia/Jerusalem', 'israel'],
  ['Tel Aviv', 'Asia/Jerusalem'],
  ['Amman', 'Asia/Amman', 'jordan'],
  ['Beirut', 'Asia/Beirut', 'lebanon'],
  ['Muscat', 'Asia/Muscat', 'oman'],
  // Asia
  ['Karachi', 'Asia/Karachi', 'pakistan'],
  ['Lahore', 'Asia/Karachi'],
  ['Islamabad', 'Asia/Karachi'],
  ['Delhi', 'Asia/Kolkata', 'new delhi'],
  ['Mumbai', 'Asia/Kolkata', 'bombay'],
  ['Kolkata', 'Asia/Kolkata', 'calcutta'],
  ['Bangalore', 'Asia/Kolkata', 'bengaluru'],
  ['Chennai', 'Asia/Kolkata', 'madras'],
  ['Hyderabad', 'Asia/Kolkata'],
  ['Pune', 'Asia/Kolkata'],
  ['India', 'Asia/Kolkata'],
  ['India Standard Time', 'Asia/Kolkata', 'ist'],
  ['Dhaka', 'Asia/Dhaka', 'bangladesh'],
  ['Kathmandu', 'Asia/Kathmandu', 'nepal'],
  ['Colombo', 'Asia/Colombo', 'sri lanka'],
  ['Bangkok', 'Asia/Bangkok', 'thailand'],
  ['Hanoi', 'Asia/Ho_Chi_Minh', 'vietnam'],
  ['Ho Chi Minh City', 'Asia/Ho_Chi_Minh', 'saigon'],
  ['Jakarta', 'Asia/Jakarta', 'indonesia'],
  ['Singapore', 'Asia/Singapore'],
  ['Kuala Lumpur', 'Asia/Kuala_Lumpur', 'malaysia'],
  ['Manila', 'Asia/Manila', 'philippines'],
  ['Hong Kong', 'Asia/Hong_Kong'],
  ['Taipei', 'Asia/Taipei', 'taiwan'],
  ['Beijing', 'Asia/Shanghai', 'china'],
  ['Shanghai', 'Asia/Shanghai'],
  ['Shenzhen', 'Asia/Shanghai'],
  ['Guangzhou', 'Asia/Shanghai'],
  ['Seoul', 'Asia/Seoul', 'south korea', 'korea', 'kst'],
  ['Tokyo', 'Asia/Tokyo', 'japan', 'jst'],
  ['Osaka', 'Asia/Tokyo'],
  ['Kyoto', 'Asia/Tokyo'],
  ['Yangon', 'Asia/Yangon', 'myanmar', 'rangoon'],
  ['Phnom Penh', 'Asia/Phnom_Penh', 'cambodia'],
  ['Kabul', 'Asia/Kabul', 'afghanistan'],
  ['Tashkent', 'Asia/Tashkent', 'uzbekistan'],
  ['Almaty', 'Asia/Almaty', 'kazakhstan'],
  ['Baku', 'Asia/Baku', 'azerbaijan'],
  ['Tbilisi', 'Asia/Tbilisi'],
  ['Yerevan', 'Asia/Yerevan', 'armenia'],
  ['Ulaanbaatar', 'Asia/Ulaanbaatar', 'mongolia'],
  // Oceania
  ['Sydney', 'Australia/Sydney', 'aest', 'aedt'],
  ['Canberra', 'Australia/Sydney'],
  ['Melbourne', 'Australia/Melbourne'],
  ['Brisbane', 'Australia/Brisbane'],
  ['Perth', 'Australia/Perth'],
  ['Adelaide', 'Australia/Adelaide'],
  ['Darwin', 'Australia/Darwin'],
  ['Hobart', 'Australia/Hobart'],
  ['Auckland', 'Pacific/Auckland', 'new zealand', 'nzst', 'nzdt'],
  ['Wellington', 'Pacific/Auckland'],
  ['Fiji', 'Pacific/Fiji'],
  ['Guam', 'Pacific/Guam'],
  ['Tahiti', 'Pacific/Tahiti'],
  ['Port Moresby', 'Pacific/Port_Moresby', 'papua new guinea'],
  // Universal
  ['UTC', 'UTC', 'utc', 'gmt', 'zulu', 'greenwich mean time', 'coordinated universal time'],
];

/** Lower-case, accent-free, punctuation-free key. */
function toKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_KEY = new Map<string, ZoneMatch>(
  ENTRIES.flatMap(([label, zone, ...aliases]) =>
    [label, ...aliases].map((name): [string, ZoneMatch] => [toKey(name), { zone, label }]),
  ),
);

/** Resolves "tokyo", "new york", "the uk" or "pst" to a time zone; null when unknown. */
export function resolveTimeZone(place: string): ZoneMatch | null {
  const key = toKey(place.split(',')[0] ?? '')
    .replace(/^the /, '')
    .replace(/ (?:time|time zone|timezone)$/, '');
  return BY_KEY.get(key) ?? null;
}

/** The zone the PC is set to. */
export function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone.length > 0 ? zone : 'UTC';
}

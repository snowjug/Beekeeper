import { matchPhrase, stripArticles } from '../text';

export interface KnownSite {
  /** Shown as "Opening <title>". */
  title: string;
  /** Spoken names, normalised (lower case, single spaces). */
  names: readonly string[];
  url: string;
}

/** Sites opened when someone says "open <name>" and no installed app has that name. */
export const KNOWN_SITES: readonly KnownSite[] = [
  { title: 'YouTube', names: ['youtube', 'you tube'], url: 'https://www.youtube.com/' },
  { title: 'Gmail', names: ['gmail', 'google mail'], url: 'https://mail.google.com/' },
  { title: 'GitHub', names: ['github', 'git hub'], url: 'https://github.com/' },
  { title: 'Reddit', names: ['reddit'], url: 'https://www.reddit.com/' },
  { title: 'X', names: ['x', 'twitter', 'x twitter'], url: 'https://x.com/' },
  { title: 'Facebook', names: ['facebook'], url: 'https://www.facebook.com/' },
  { title: 'Instagram', names: ['instagram', 'insta'], url: 'https://www.instagram.com/' },
  { title: 'Netflix', names: ['netflix'], url: 'https://www.netflix.com/' },
  { title: 'Amazon', names: ['amazon'], url: 'https://www.amazon.com/' },
  { title: 'LinkedIn', names: ['linkedin', 'linked in'], url: 'https://www.linkedin.com/' },
  { title: 'Wikipedia', names: ['wikipedia', 'wiki'], url: 'https://www.wikipedia.org/' },
  {
    title: 'Stack Overflow',
    names: ['stack overflow', 'stackoverflow'],
    url: 'https://stackoverflow.com/',
  },
  { title: 'ChatGPT', names: ['chatgpt', 'chat gpt'], url: 'https://chatgpt.com/' },
  {
    title: 'Outlook on the web',
    names: ['outlook web', 'outlook web app', 'outlook online', 'outlook on the web'],
    url: 'https://outlook.office.com/mail/',
  },
  { title: 'Google', names: ['google'], url: 'https://www.google.com/' },
  { title: 'Bing', names: ['bing'], url: 'https://www.bing.com/' },
  { title: 'Google Maps', names: ['google maps'], url: 'https://www.google.com/maps' },
  { title: 'Google Drive', names: ['google drive'], url: 'https://drive.google.com/' },
  { title: 'Google Docs', names: ['google docs'], url: 'https://docs.google.com/' },
  { title: 'Google Calendar', names: ['google calendar'], url: 'https://calendar.google.com/' },
  { title: 'Google Translate', names: ['google translate'], url: 'https://translate.google.com/' },
  { title: 'Twitch', names: ['twitch'], url: 'https://www.twitch.tv/' },
  { title: 'TikTok', names: ['tiktok', 'tik tok'], url: 'https://www.tiktok.com/' },
  { title: 'Pinterest', names: ['pinterest'], url: 'https://www.pinterest.com/' },
  { title: 'Hacker News', names: ['hacker news'], url: 'https://news.ycombinator.com/' },
  { title: 'DuckDuckGo', names: ['duckduckgo', 'duck duck go'], url: 'https://duckduckgo.com/' },
];

const ALL_NAMES: readonly string[] = KNOWN_SITES.flatMap((site) => site.names);
const SITE_SUFFIX = /\s+(?:website|web site|site|web)$/;

/** The website a spoken name refers to ("youtube", "google maps", "the reddit website"), or null. */
export function findKnownSite(query: string): KnownSite | null {
  const text = stripArticles(query.trim().toLowerCase().replace(/\s+/g, ' '));
  if (text.length === 0) return null;
  // "outlook web" is a name of its own; "reddit website" is "reddit" plus a filler word.
  const matched =
    matchPhrase(text, ALL_NAMES) ?? matchPhrase(text.replace(SITE_SUFFIX, ''), ALL_NAMES);
  if (matched === null) return null;
  return KNOWN_SITES.find((site) => site.names.includes(matched)) ?? null;
}

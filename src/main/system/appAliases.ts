import { levenshtein, stripArticles, typoBudget } from '../commands/text';

/**
 * Spoken names for apps, the Start menu names they resolve to and the process image names used for
 * closing. All strings are normalised (see normalizeAppName).
 */
export interface AppAlias {
  /** Name used in messages ("Visual Studio Code"). */
  display: string;
  /** What people say. */
  phrases: readonly string[];
  /** Start menu / built-in app names to look for, most specific first. */
  names: readonly string[];
  /** Process image names (no extension) of the app's windows. */
  processes?: readonly string[];
}

export const APP_ALIASES: readonly AppAlias[] = [
  {
    display: 'Visual Studio Code',
    phrases: ['vs code', 'vscode', 'visual studio code', 'code', 'v s code', 'visual code'],
    names: ['visual studio code', 'code'],
    processes: ['code'],
  },
  {
    display: 'File Explorer',
    phrases: ['explorer', 'file explorer', 'files', 'file manager', 'windows explorer', 'my files'],
    names: ['file explorer', 'windows explorer', 'explorer'],
    processes: ['explorer'],
  },
  {
    display: 'Task Manager',
    phrases: ['task manager', 'taskmanager', 'task mgr', 'taskmgr'],
    names: ['task manager'],
    processes: ['taskmgr'],
  },
  {
    display: 'Settings',
    phrases: ['settings', 'windows settings', 'system settings', 'pc settings'],
    names: ['settings'],
    processes: ['systemsettings'],
  },
  {
    display: 'Calculator',
    phrases: ['calculator', 'calc', 'windows calculator'],
    names: ['calculator'],
    processes: ['calculatorapp', 'calculator', 'win32calc', 'calc'],
  },
  {
    display: 'Notepad',
    phrases: ['notepad', 'note pad', 'text editor'],
    names: ['notepad'],
    processes: ['notepad'],
  },
  {
    display: 'Microsoft Edge',
    phrases: ['edge', 'microsoft edge', 'ms edge'],
    names: ['microsoft edge'],
    processes: ['msedge'],
  },
  {
    display: 'Google Chrome',
    phrases: ['chrome', 'google chrome'],
    names: ['google chrome', 'chrome'],
    processes: ['chrome'],
  },
  {
    display: 'Firefox',
    phrases: ['firefox', 'mozilla firefox', 'fire fox'],
    names: ['firefox', 'mozilla firefox'],
    processes: ['firefox'],
  },
  {
    display: 'Microsoft Teams',
    phrases: ['teams', 'microsoft teams', 'ms teams'],
    names: ['microsoft teams', 'teams'],
    processes: ['ms-teams', 'teams'],
  },
  {
    display: 'Outlook',
    phrases: ['outlook', 'microsoft outlook', 'ms outlook'],
    names: ['outlook', 'microsoft outlook', 'outlook new'],
    processes: ['outlook', 'olk'],
  },
  {
    display: 'Spotify',
    phrases: ['spotify', 'spotify music'],
    names: ['spotify'],
    processes: ['spotify'],
  },
  {
    display: 'Word',
    phrases: ['word', 'ms word', 'microsoft word'],
    names: ['word', 'microsoft word'],
    processes: ['winword'],
  },
  {
    display: 'Excel',
    phrases: ['excel', 'ms excel', 'microsoft excel'],
    names: ['excel', 'microsoft excel'],
    processes: ['excel'],
  },
  {
    display: 'PowerPoint',
    phrases: ['powerpoint', 'power point', 'ms powerpoint', 'microsoft powerpoint', 'ppt'],
    names: ['powerpoint', 'microsoft powerpoint'],
    processes: ['powerpnt'],
  },
  {
    display: 'OneNote',
    phrases: ['onenote', 'one note', 'microsoft onenote'],
    names: ['onenote', 'microsoft onenote', 'onenote for windows 10'],
    processes: ['onenote', 'onenotem'],
  },
  {
    display: 'Windows Terminal',
    phrases: ['terminal', 'windows terminal', 'wt'],
    names: ['windows terminal', 'terminal'],
    processes: ['windowsterminal'],
  },
  {
    display: 'Command Prompt',
    phrases: ['cmd', 'command prompt', 'command line', 'console'],
    names: ['command prompt'],
    processes: ['cmd'],
  },
  {
    display: 'Windows PowerShell',
    phrases: ['powershell', 'power shell', 'windows powershell'],
    names: ['windows powershell', 'powershell'],
    processes: ['powershell', 'pwsh'],
  },
  {
    display: 'Paint',
    phrases: ['paint', 'ms paint', 'mspaint', 'microsoft paint'],
    names: ['paint'],
    processes: ['mspaint'],
  },
  {
    display: 'Snipping Tool',
    phrases: ['snipping tool', 'snip', 'snipping', 'snip and sketch', 'screen snip'],
    names: ['snipping tool'],
    processes: ['snippingtool'],
  },
  {
    display: 'Control Panel',
    phrases: ['control panel', 'control'],
    names: ['control panel'],
  },
  {
    display: 'Microsoft Store',
    phrases: ['store', 'microsoft store', 'app store', 'windows store'],
    names: ['microsoft store'],
    processes: ['winstore.app'],
  },
  {
    display: 'Registry Editor',
    phrases: ['regedit', 'registry editor'],
    names: ['registry editor'],
    processes: ['regedit'],
  },
];

/**
 * Lower-cases, strips Latin accents and turns everything that is not a letter, mark or digit into one
 * space. Marks of other scripts (kana voicing, Devanagari vowel signs) belong to their letters and stay.
 */
export function normalizeAppName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\+\+/g, ' plus plus ')
    .replace(/#/g, ' sharp ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

const GENERIC_SUFFIX = /\s+(?:app|application|program|software|browser|client)$/;

/**
 * Normalises what the user said for matching: "the Calculator app" -> ["calculator app", "calculator"].
 * Variants are ordered from most to least literal.
 */
export function queryVariants(raw: string): string[] {
  const literal = stripArticles(normalizeAppName(raw));
  if (literal.length === 0) return [];
  const bare = literal.replace(GENERIC_SUFFIX, '');
  return bare.length > 0 && bare !== literal ? [literal, bare] : [literal];
}

export interface AliasHit {
  alias: AppAlias;
  /** False when the phrase was recognised through typo tolerance only. */
  exact: boolean;
}

/** Aliases whose spoken phrase equals the variant (or is a typo of it, for phrases of 5+ letters). */
export function matchAliases(variants: readonly string[]): AliasHit[] {
  const hits: AliasHit[] = [];
  for (const alias of APP_ALIASES) {
    let best: AliasHit | null = null;
    for (const phrase of alias.phrases) {
      for (const variant of variants) {
        if (variant === phrase) {
          best = { alias, exact: true };
        } else if (best === null) {
          const budget = typoBudget(phrase.length);
          if (budget > 0 && levenshtein(variant, phrase, budget) <= budget) {
            best = { alias, exact: false };
          }
        }
      }
    }
    if (best !== null) hits.push(best);
  }
  return hits;
}

function titleCase(text: string): string {
  return text
    .split(' ')
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/** Friendly app name for messages: "vs code" -> "Visual Studio Code", "foo bar" -> "Foo Bar". */
export function displayNameFor(query: string): string {
  const variants = queryVariants(query);
  const [hit] = matchAliases(variants);
  if (hit !== undefined) return hit.alias.display;
  const [first] = variants;
  return first === undefined ? query.trim() : titleCase(first);
}

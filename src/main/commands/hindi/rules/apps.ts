/** Rules for apps and the web: open / close an app or site, web search, YouTube. */
import { NOISE, type Utterance } from '../utterance';
import { accounted, isStatement, nameOf, type Rule } from './common';

const OBJECT_GLUE = ['KO', 'KA', 'ME', 'MY', 'ON', 'IN', 'FOR', 'NOW', 'THAT', 'PUT'];

// ---------------------------------------------------------------------------
// Open and close: "यूट्यूब खोलो", "ओपन क्रोम", "क्रोम बंद करो", "github.com खोलो"
// ---------------------------------------------------------------------------

export const openRule: Rule = (u) => {
  const goes = u.has('GO') && u.has('ON', 'KO');
  if (u.has('NO', 'PAST') || !(u.has('OPEN', 'START', 'PLAY') || goes)) return null;
  const apps = u.toks.filter((token) => token.sym === 'APP');
  const words = u.toks.filter((token) => token.sym === 'W');
  const allowed = [
    'OPEN',
    'START',
    'PLAY',
    'GO',
    ...OBJECT_GLUE,
    'APP',
    'APPW',
    'W',
    'DOMAIN',
    'DOT',
    'PHOTO',
  ];
  if (!accounted(u, allowed)) return null;

  const domain = u.find('DOMAIN');
  if (domain !== undefined) return `open ${domain.payload ?? domain.text}`;
  const dot = u.find('DOT');
  if (dot !== undefined) {
    const named = u.toks.filter((token) => token.sym === 'APP' || token.sym === 'W');
    const name = named.map(nameOf).join('').replace(/\s+/g, '');
    return name === '' ? null : `open ${name}${dot.payload ?? ''}`;
  }
  if (apps.length === 1 && words.length === 0) return `open ${apps[0]?.payload ?? ''}`;
  if (apps.length === 0 && u.has('PHOTO') && words.length === 0) return 'open photos';
  if (u.has('OPEN') && apps.length === 0 && words.length >= 1 && words.length <= 3) {
    return `open ${words.map(nameOf).join(' ')}`;
  }
  return null;
};

export const closeRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || isStatement(u) || !u.has('OFF')) return null;
  const apps = u.toks.filter((token) => token.sym === 'APP');
  const words = u.toks.filter((token) => token.sym === 'W');
  if (!accounted(u, ['OFF', ...OBJECT_GLUE, 'APP', 'APPW', 'W'])) return null;
  if (apps.length === 1 && words.length === 0) return `close ${apps[0]?.payload ?? ''}`;
  // An unknown Devanagari word could be anything ("दरवाज़ा"): only Latin names are closed.
  const latin =
    words.length >= 1 && words.length <= 2 && words.every((word) => word.kind === 'lat');
  return apps.length === 0 && latin
    ? `close ${words.map((word) => word.text.toLowerCase()).join(' ')}`
    : null;
};

// ---------------------------------------------------------------------------
// Search: "गूगल पर X सर्च करो", "यूट्यूब पर X चलाओ", "X सर्च करो"
// ---------------------------------------------------------------------------

/** Sentence frame words that never belong to the text being searched for. */
const QUERY_EDGE: ReadonlySet<string> = new Set([
  ...[...NOISE].filter((sym) => sym !== 'BE' && sym !== 'HOTA'),
  'ME',
  'MY',
  'ON',
  'KO',
  'KA',
  'IN',
  'FOR',
  'SEARCH',
  'PLAY',
  'SET',
  'START',
  'AND',
  'THAT',
  'NOW',
  'ABOUT',
  'TELL',
  'GO',
]);
/** Searching these is a job for other commands (notes, reminders, screen search). */
const NOT_A_WEB_QUERY = [
  'NOTE',
  'NOTES',
  'TIMER',
  'ALARM',
  'REMINDER',
  'REMIND',
  'SCREEN',
  'CIRCLE',
];

function queryOf(u: Utterance, used: ReadonlySet<number>): string | null {
  const kept = u.toks.map((_, index) => index).filter((index) => !used.has(index));
  while (kept.length > 0 && QUERY_EDGE.has(u.toks[kept[0] ?? 0]?.sym ?? '')) kept.shift();
  while (kept.length > 0 && QUERY_EDGE.has(u.toks[kept[kept.length - 1] ?? 0]?.sym ?? '')) {
    kept.pop();
  }
  const tokens = kept.map((index) => u.toks[index]);
  if (tokens.some((token) => token !== undefined && NOT_A_WEB_QUERY.includes(token.sym))) {
    return null;
  }
  const text = tokens
    .map((token) => token?.text ?? '')
    .join(' ')
    .trim();
  return text === '' ? null : text;
}

export const searchRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || u.has('OPEN')) return null;
  const engineAt = u.toks.findIndex(
    (token) => token.sym === 'APP' && ['youtube', 'google', 'bing'].includes(token.payload ?? ''),
  );
  const engine = engineAt >= 0 ? u.toks[engineAt]?.payload : undefined;
  const used = new Set<number>(engineAt >= 0 ? [engineAt] : []);

  if (engine === 'youtube') {
    const query = queryOf(u, used);
    if (query === null) return null;
    if (u.has('SEARCH')) return `search youtube for ${query}`;
    return u.has('PLAY', 'SET', 'START') ? `play ${query} on youtube` : `youtube ${query}`;
  }
  if (engine !== undefined) {
    const query = queryOf(u, used);
    return query === null || !u.has('SEARCH', 'ON') ? null : `${engine} ${query}`;
  }
  if (!u.has('SEARCH')) return null;
  const query = queryOf(u, used);
  return query === null ? null : `search for ${query}`;
};

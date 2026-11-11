/** Rules for the PC controls: volume, brightness, theme, screenshot, lock, power, recycle bin, settings. */
import type { Utterance } from '../utterance';
import { accounted, isStatement, type Rule } from './common';

// ---------------------------------------------------------------------------
// Volume and brightness: "आवाज़ बढ़ाओ", "ब्राइटनेस 70 प्रतिशत करो", "म्यूट करो"
// ---------------------------------------------------------------------------

const LEVEL_ALLOWED = [
  'INC',
  'DEC',
  'NUM',
  'PERCENT',
  'SET',
  'THODA',
  'MAX',
  'MINW',
  'KA',
  'KO',
  'ON',
  'TELL',
  'HOWMUCH',
  'WHAT',
  'ME',
  'MY',
  'NOW',
  'HOW',
  'FOR',
  'IN',
  'TILL',
  'SCREEN',
];

/** Shared grammar of the 0-100 levels: step up / down, set to a number or a named level, ask. */
function levelCommand(u: Utterance, noun: string): string | null {
  const up = u.has('INC');
  const down = u.has('DEC');
  if (up && down) return null;
  const number = u.find('NUM');
  const amount = number?.value;
  if (u.count('NUM') > 1) return null;

  if (u.has('MAX')) return `set ${noun} to max`;
  if (u.has('MINW')) return `set ${noun} to minimum`;
  const named = amount !== undefined && amount > 0 && amount < 1 && !u.has('PERCENT');
  if (amount !== undefined && (named || !(up || down) || u.has('TILL'))) {
    if (named) return `set ${noun} to half`;
    return `set ${noun} to ${Math.round(Math.min(100, Math.max(0, amount)))}%`;
  }
  if (up || down) {
    const word = up ? 'up' : 'down';
    if (amount !== undefined) return `${up ? 'increase' : 'decrease'} ${noun} by ${amount}`;
    return `${noun} ${word}${u.has('THODA') ? ' a little' : ''}`;
  }
  if (u.has('HOWMUCH', 'WHAT', 'TELL')) return `what's the ${noun}`;
  return null;
}

export const volumeRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || !u.has('VOLUME', 'SOUND', 'MUTE', 'UNMUTE')) return null;
  if (
    !accounted(u, [
      ...LEVEL_ALLOWED,
      'VOLUME',
      'SOUND',
      'MUTE',
      'UNMUTE',
      'OFF',
      'START',
      'PC',
      'AGAIN',
    ])
  ) {
    return null;
  }
  const noun = u.has('VOLUME', 'SOUND');
  const direction = u.has('INC', 'DEC');
  if (u.has('UNMUTE')) return 'unmute';
  if (u.has('MUTE')) return u.has('OFF') ? 'unmute' : 'mute';
  if (noun && u.has('OFF') && !direction) return 'mute';
  if (noun && u.has('START') && !direction) return 'unmute';
  if (!noun) return null;
  return levelCommand(u, 'volume');
};

export const brightnessRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || !u.has('BRIGHT')) return null;
  if (!accounted(u, [...LEVEL_ALLOWED, 'BRIGHT'])) return null;
  return levelCommand(u, 'brightness');
};

// ---------------------------------------------------------------------------
// Dark mode: "डार्क मोड चालू करो", "लाइट थीम लगाओ", "डार्क मोड बदलो"
// ---------------------------------------------------------------------------

export const darkModeRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || !u.has('DARK', 'LIGHTM') || !u.has('MODE', 'THEME')) return null;
  if (u.has('DARK') && u.has('LIGHTM')) return null;
  const allowed = [
    'DARK',
    'LIGHTM',
    'MODE',
    'THEME',
    'START',
    'OFF',
    'CHANGE',
    'SET',
    'PLAY',
    'KA',
    'KO',
    'ME',
    'NOW',
    'ON',
    'IN',
    'PUT',
  ];
  if (!accounted(u, allowed)) return null;
  const theme = u.has('DARK') ? 'dark' : 'light';
  if (u.has('CHANGE')) return 'toggle dark mode';
  if (u.has('START')) return `turn on ${theme} mode`;
  if (u.has('OFF')) return `turn off ${theme} mode`;
  if (u.has('SET', 'PLAY', 'PUT')) return `switch to ${theme} mode`;
  return `${theme} mode`;
};

// ---------------------------------------------------------------------------
// Screenshot, lock, recycle bin
// ---------------------------------------------------------------------------

export const screenshotRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const direct = u.has('SCREENSHOT');
  const viaScreen = u.has('SCREEN') && u.has('CAPTURE', 'PHOTO');
  if (!direct && !viaScreen) return null;
  if (
    !accounted(u, [
      'SCREENSHOT',
      'SCREEN',
      'CAPTURE',
      'PHOTO',
      'TAKE',
      'KA',
      'KO',
      'ME',
      'MY',
      'NOW',
      'THAT',
      'ON',
    ])
  ) {
    return null;
  }
  return direct || u.has('PHOTO') ? 'take a screenshot' : 'capture the screen';
};

export const lockRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || isStatement(u) || !u.has('LOCK')) return null;
  if (!accounted(u, ['LOCK', 'PC', 'SCREEN', 'KO', 'KA', 'MY', 'NOW', 'ME', 'THAT'])) return null;
  if (u.has('PC')) return 'lock my pc';
  return u.has('SCREEN') ? 'lock screen' : 'lock';
};

export const recycleRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || isStatement(u) || !u.has('RECYCLE') || !u.has('EMPTY', 'DEL')) {
    return null;
  }
  if (
    !accounted(u, [
      'RECYCLE',
      'EMPTY',
      'DEL',
      'KA',
      'KO',
      'MY',
      'ME',
      'NOW',
      'IN',
      'THAT',
      'ALL',
      'FROM',
    ])
  ) {
    return null;
  }
  return 'empty the recycle bin';
};

// ---------------------------------------------------------------------------
// Power: "कंप्यूटर बंद करो", "लैपटॉप रीस्टार्ट करो", "कंप्यूटर को स्लीप मोड में डालो"
// ---------------------------------------------------------------------------

const POWER_ALLOWED = [
  'PC',
  'KO',
  'KA',
  'MY',
  'ME',
  'NOW',
  'THAT',
  'MODE',
  'PUT',
  'IN',
  'ON',
  'AGAIN',
  'START',
  'OFF',
];

export const powerRule: Rule = (u) => {
  if (u.has('NO', 'PAST') || isStatement(u)) return null;
  const pc = u.has('PC');
  if (u.has('SHUTDOWN') && accounted(u, [...POWER_ALLOWED, 'SHUTDOWN'])) {
    return pc ? 'shut down my pc' : 'shut down';
  }
  if (u.has('RESTART') && accounted(u, [...POWER_ALLOWED, 'RESTART'])) {
    return pc ? 'restart my pc' : 'restart';
  }
  if (u.has('SLEEPM') && accounted(u, [...POWER_ALLOWED, 'SLEEPM'])) {
    return pc ? 'put my pc to sleep' : 'sleep';
  }
  if (pc && u.has('AGAIN') && u.has('START') && accounted(u, POWER_ALLOWED)) return 'restart my pc';
  if (pc && u.has('OFF') && !u.has('AGAIN', 'START') && accounted(u, POWER_ALLOWED)) {
    return 'turn off my pc';
  }
  return null;
};

// ---------------------------------------------------------------------------
// Settings: "वाईफाई सेटिंग्स खोलो", "ब्लूटूथ खोलो", "सेटिंग्स खोलो"
// ---------------------------------------------------------------------------

const PAGE_SYMS: Readonly<Record<string, string>> = {
  WIFI: 'wifi',
  BLUETOOTH: 'bluetooth',
  DISPLAY: 'display',
  BRIGHT: 'display',
  SOUND: 'sound',
};

export const settingsRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const pages = u.toks.filter((token) => PAGE_SYMS[token.sym] !== undefined);
  const verb = u.has('OPEN', 'START', 'TELL', 'PLAY');
  if (!verb) return null;
  const allowed = [
    'SETTINGS',
    'OPEN',
    'START',
    'TELL',
    'PLAY',
    'KA',
    'KO',
    'ME',
    'MY',
    'NOW',
    'ON',
    'THAT',
    'PUT',
  ];
  if (pages.length === 0) {
    return u.has('SETTINGS') && accounted(u, allowed) ? 'open settings' : null;
  }
  const [page] = pages;
  if (pages.length !== 1 || page === undefined || !accounted(u, [...allowed, page.sym]))
    return null;
  const name = PAGE_SYMS[page.sym] ?? '';
  const needsSettings = page.sym === 'DISPLAY' || page.sym === 'BRIGHT' || page.sym === 'SOUND';
  if (needsSettings && !u.has('SETTINGS')) return null;
  return `open ${name} settings`;
};

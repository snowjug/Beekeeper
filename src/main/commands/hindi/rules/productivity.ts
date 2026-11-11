/** Rules for timers, alarms, reminders, notes and "copy that". */
import type { Tok } from '../pipeline';
import { NOISE, type Utterance } from '../utterance';
import { accounted, type Rule } from './common';

function clockPhrase(token: Tok): string {
  return `${token.day === undefined ? '' : `${token.day} `}at ${token.time ?? ''}`;
}

const MANAGE_CANCEL = ['CANCEL', 'DEL', 'OFF', 'STOPW'];

// ---------------------------------------------------------------------------
// Timers: "5 मिनट का टाइमर लगाओ", "टाइमर रद्द करो", "कितना समय बचा है"
// ---------------------------------------------------------------------------

const TIMER_CANCEL_ALLOWED = [
  'TIMER',
  ...MANAGE_CANCEL,
  'ALL',
  'MY',
  'KA',
  'KO',
  'THAT',
  'LAST',
  'NEW',
  'DUR',
  'FOR',
  'NOW',
  'ME',
];
const TIMER_LEFT_ALLOWED = [
  'TIMER',
  'LEFT',
  'HOWMUCH',
  'TIME',
  'WHAT',
  'MY',
  'KA',
  'IN',
  'NOW',
  'TELL',
  'ME',
];
const TIMER_LIST_ALLOWED = ['TIMER', 'TELL', 'MY', 'ALL', 'KA', 'NOW', 'ME', 'WHAT', 'IN'];
const TIMER_START_ALLOWED = [
  'TIMER',
  'DUR',
  'SET',
  'START',
  'PLAY',
  'FOR',
  'KA',
  'KO',
  'IN',
  'ON',
  'ME',
  'MY',
  'NEW',
  'THAT',
  'AFTER',
];

export const timerRule: Rule = (u) => {
  if (!u.has('TIMER') && u.has('LEFT') && u.has('TIME') && u.has('HOWMUCH', 'WHAT')) {
    return !u.has('NO') && accounted(u, TIMER_LEFT_ALLOWED)
      ? 'how much time is left on my timer'
      : null;
  }
  if (!u.has('TIMER') || u.has('NO')) return null;
  const duration = u.find('DUR');

  if (u.has(...MANAGE_CANCEL)) {
    if (!accounted(u, TIMER_CANCEL_ALLOWED)) return null;
    if (duration !== undefined) return `cancel the ${duration.payload ?? ''} timer`;
    return u.has('ALL') ? 'cancel all timers' : 'cancel my timer';
  }
  if (u.has('LEFT') || (u.has('HOWMUCH') && u.has('TIME'))) {
    return accounted(u, TIMER_LEFT_ALLOWED) ? 'how much time is left on my timer' : null;
  }
  if (u.has('TELL') && duration === undefined) {
    return accounted(u, TIMER_LIST_ALLOWED) ? 'show my timers' : null;
  }

  const words = u.toks.filter((token) => token.sym === 'W');
  const used = new Set(u.toks.flatMap((token, index) => (token.sym === 'W' ? [index] : [])));
  if (words.length > 2 || !accounted(u, TIMER_START_ALLOWED, used)) return null;
  if (duration === undefined) {
    return words.length === 0 && u.has('SET', 'START', 'PLAY') ? 'set a timer' : null;
  }
  const label = words.map((word) => word.text).join(' ');
  return `set a timer for ${duration.payload ?? ''}${label === '' ? '' : ` called ${label}`}`;
};

// ---------------------------------------------------------------------------
// Alarms: "कल सुबह सात बजे का अलार्म लगाओ", "मुझे सुबह 6 बजे उठा देना"
// ---------------------------------------------------------------------------

const ALARM_ALLOWED = [
  'ALARM',
  'CLK',
  'SET',
  'START',
  'PLAY',
  'FOR',
  'KA',
  'KO',
  'ON',
  'IN',
  'ME',
  'MY',
  'NEW',
  'THAT',
  'TODAY',
  'TOMORROW',
  'DUR',
  'AFTER',
];
const ALARM_CANCEL_ALLOWED = [
  'ALARM',
  'CLK',
  ...MANAGE_CANCEL,
  'ALL',
  'MY',
  'KA',
  'KO',
  'THAT',
  'LAST',
  'NEW',
  'NOW',
  'ME',
];
const ALARM_LIST_ALLOWED = [
  'ALARM',
  'TELL',
  'MY',
  'ALL',
  'KA',
  'NOW',
  'ME',
  'WHAT',
  'WHEN',
  'IN',
  'FUT',
];

export const alarmRule: Rule = (u) => {
  if (u.has('NO')) return null;
  const clock = u.find('CLK');
  const duration = u.find('DUR');

  if (u.has('WAKE')) {
    if (
      !accounted(u, [
        'WAKE',
        'CLK',
        'DUR',
        'ME',
        'KO',
        'KA',
        'FOR',
        'IN',
        'AFTER',
        'TODAY',
        'TOMORROW',
      ])
    ) {
      return null;
    }
    if (clock !== undefined) return `wake me up ${clockPhrase(clock)}`;
    return duration === undefined ? null : `wake me up in ${duration.payload ?? ''}`;
  }
  if (!u.has('ALARM')) return null;

  if (u.has(...MANAGE_CANCEL)) {
    if (!accounted(u, ALARM_CANCEL_ALLOWED)) return null;
    if (clock?.time !== undefined) return `cancel the ${clock.time} alarm`;
    return u.has('ALL') ? 'cancel all alarms' : 'cancel my alarm';
  }
  if (u.has('TELL', 'WHEN') && clock === undefined) {
    return accounted(u, ALARM_LIST_ALLOWED) ? 'show my alarms' : null;
  }
  if (!accounted(u, ALARM_ALLOWED)) return null;
  if (clock !== undefined) return `set an alarm for ${clockPhrase(clock).replace(/^at /, '')}`;
  if (duration !== undefined) return `set an alarm in ${duration.payload ?? ''}`;
  const day = u.find('TOMORROW') ?? u.find('TODAY');
  if (day !== undefined) return `set an alarm for ${day.sym === 'TOMORROW' ? 'tomorrow' : 'today'}`;
  return u.has('SET', 'START', 'PLAY') ? 'set an alarm' : null;
};

// ---------------------------------------------------------------------------
// Reminders: "मुझे शाम 6 बजे दूध लाने की याद दिलाना", "रिमाइंडर दिखाओ"
// ---------------------------------------------------------------------------

/**
 * Symbols that frame a sentence but are not part of what a note or reminder says. The light verb
 * "करना" stays: "फोन करना" is the task.
 */
const EDGE_SYMS: ReadonlySet<string> = new Set([
  ...[...NOISE].filter((sym) => sym !== 'DO'),
  'ME',
  'MY',
  'SET',
  'START',
  'KA',
  'FOR',
  'AND',
  'IN',
  'AFTER',
  'NEW',
  'PLAY',
]);

/** "दूध लाने" (as in "दूध लाने की याद") is the task "दूध लाना". */
function nominalTask(text: string): string {
  return text.replace(/ने$/, 'ना');
}

/** The tokens left of a sentence once the structural ones (`used`) and the frame words at both ends are removed. */
function contentTokens(
  u: Utterance,
  used: ReadonlySet<number>,
  keepAtEnd: ReadonlySet<string> = new Set(),
): Tok[] {
  const kept = u.toks.map((_, index) => index).filter((index) => !used.has(index));
  while (kept.length > 0 && EDGE_SYMS.has(u.toks[kept[0] ?? 0]?.sym ?? '')) kept.shift();
  while (kept.length > 0) {
    const sym = u.toks[kept[kept.length - 1] ?? 0]?.sym ?? '';
    if (!EDGE_SYMS.has(sym) || keepAtEnd.has(sym)) break;
    kept.pop();
  }
  return kept.flatMap((index) => u.toks[index] ?? []);
}

function contentOf(
  u: Utterance,
  used: ReadonlySet<number>,
  keepAtEnd: ReadonlySet<string> = new Set(),
): string {
  return contentTokens(u, used, keepAtEnd)
    .map((token) => token.text)
    .join(' ')
    .trim();
}

/** Words that only carry grammar: a note made of nothing else ("कहाँ हैं") is a question, not a note. */
const GRAMMAR_ONLY: ReadonlySet<string> = new Set([
  'WHAT',
  'HOW',
  'HOWMUCH',
  'WHEN',
  'WHICH',
  'WHO',
  'WHERE',
  'BE',
  'FUT',
  'PAST',
  'HOTA',
  'KA',
  'KO',
  'IN',
  'I',
  'ON',
  'FROM',
  'TILL',
  'FOR',
  'AFTER',
  'BEFORE',
  'AND',
  'OR',
  'WITH',
  'THAT',
  'NO',
  'YOU',
  'ME',
  'MY',
  'YOUR',
  'NOW',
  'HERE',
  'WENT',
]);

/** Marks the nearest token (within `reach` places of `anchor`) that has one of `syms` as used. */
function markNearby(
  u: Utterance,
  used: Set<number>,
  anchor: number,
  syms: readonly string[],
  reach = 2,
): boolean {
  for (let distance = 1; distance <= reach; distance += 1) {
    for (const index of [anchor + distance, anchor - distance]) {
      if (syms.includes(u.toks[index]?.sym ?? '')) {
        used.add(index);
        return true;
      }
    }
  }
  return false;
}

const REMINDER_MANAGE_ALLOWED = [
  'REMINDER',
  ...MANAGE_CANCEL,
  'ALL',
  'MY',
  'KA',
  'KO',
  'THAT',
  'LAST',
  'NEW',
  'NOW',
  'ME',
];
const REMINDER_LIST_ALLOWED = [
  'REMINDER',
  'TELL',
  'MY',
  'ALL',
  'KA',
  'NOW',
  'ME',
  'WHAT',
  'WHEN',
  'IN',
  'FUT',
];

export const reminderRule: Rule = (u) => {
  if (u.has('NO')) return null;
  const anchor = u.toks.findIndex((token) => ['REMIND', 'REMINDV', 'REMINDER'].includes(token.sym));
  if (anchor < 0) return null;
  const sym = u.toks[anchor]?.sym;

  if (sym === 'REMINDER') {
    if (u.has(...MANAGE_CANCEL) && accounted(u, REMINDER_MANAGE_ALLOWED)) {
      return u.has('ALL') ? 'cancel all reminders' : 'cancel my reminder';
    }
    if (u.has('TELL', 'WHEN') && !u.has('CLK', 'DUR') && accounted(u, REMINDER_LIST_ALLOWED)) {
      return 'show my reminders';
    }
    if (!u.has('SET', 'START', 'PLAY', 'DO')) return null;
  }

  const used = new Set<number>([anchor]);
  const clock = u.toks.findIndex((token) => token.sym === 'CLK');
  const duration = u.toks.findIndex((token) => token.sym === 'DUR');
  const day = u.toks.findIndex((token) => token.sym === 'TODAY' || token.sym === 'TOMORROW');
  let when = '';
  if (clock >= 0) {
    used.add(clock);
    when = clockPhrase(u.toks[clock] as Tok);
  } else if (duration >= 0) {
    used.add(duration);
    when = `in ${u.toks[duration]?.payload ?? ''}`;
    for (const next of [duration + 1, duration - 1]) {
      if (['IN', 'AFTER'].includes(u.toks[next]?.sym ?? '')) used.add(next);
    }
  } else if (day >= 0) {
    used.add(day);
    when = u.toks[day]?.sym === 'TOMORROW' ? 'tomorrow' : 'today';
  }
  u.toks.forEach((token, index) => {
    if (token.sym === 'ME') used.add(index);
  });
  if (sym !== 'REMIND') markNearby(u, used, anchor, ['DO', 'SET', 'START', 'PLAY']);
  const genitive = u.toks[anchor - 1]?.sym === 'KA';
  if (genitive) used.add(anchor - 1);
  if (u.toks[anchor + 1]?.sym === 'KA') used.add(anchor + 1);

  const raw = contentOf(u, used);
  const text = sym === 'REMIND' && genitive ? nominalTask(raw) : raw;
  return `remind me${when === '' ? '' : ` ${when}`}${text === '' ? '' : ` to ${text}`}`;
};

// ---------------------------------------------------------------------------
// Notes: "नोट करो कि दूध लाना है", "मेरे नोट्स दिखाओ", "आख़िरी नोट हटाओ"
// ---------------------------------------------------------------------------

const NOTE_VERBS = ['DO', 'WRITE', 'SAVE', 'SET', 'PLUS', 'KEEP', 'START', 'MAKE'];
const NOTE_DELETE_ALLOWED = [
  'NOTE',
  'NOTES',
  'DEL',
  'CANCEL',
  'EMPTY',
  'LAST',
  'ALL',
  'MY',
  'KA',
  'KO',
  'THAT',
  'ME',
  'NEW',
];
const NOTE_LIST_ALLOWED = [
  'NOTE',
  'NOTES',
  'TELL',
  'MY',
  'ALL',
  'KA',
  'NOW',
  'ME',
  'WHAT',
  'LAST',
  'IN',
];

/** The words a notes search is about: "दूध के बारे में नोट्स दिखाओ", "नोट्स में दूध खोजो". */
function notesQuery(u: Utterance, noteAt: number): string {
  const about = u.indexOf('ABOUT');
  if (about > 0 && about < noteAt)
    return contentOf(u, new Set(u.toks.map((_, i) => i).filter((i) => i >= about)));
  const search = u.indexOf('SEARCH');
  if (u.toks[noteAt + 1]?.sym === 'IN' && search > noteAt + 1) {
    return contentOf(
      u,
      new Set(
        u.toks.map((_, index) => index).filter((index) => index <= noteAt + 1 || index >= search),
      ),
    );
  }
  return '';
}

export const notesRule: Rule = (u) => {
  if (u.has('NO', 'PAST')) return null;
  const noteAt = u.toks.findIndex((token) => token.sym === 'NOTE' || token.sym === 'NOTES');

  if (noteAt >= 0 && u.has('DEL', 'CANCEL', 'EMPTY') && accounted(u, NOTE_DELETE_ALLOWED)) {
    return u.has('ALL') || u.has('NOTES') ? 'delete all my notes' : 'delete my last note';
  }
  if (noteAt >= 0 && u.has('TELL', 'SEARCH')) {
    if (accounted(u, NOTE_LIST_ALLOWED)) return 'show my notes';
    const query = notesQuery(u, noteAt);
    return query === '' ? null : `search notes for ${query}`;
  }

  const remember = u.has('YAAD') && u.has('KEEP');
  const anchor = remember ? u.indexOf('YAAD') : noteAt;
  if (anchor < 0) return null;
  const used = new Set<number>([anchor]);
  if (remember) used.add(u.indexOf('KEEP'));
  else if (!markNearby(u, used, anchor, NOTE_VERBS, 4)) return null;
  for (const index of [...used]) {
    if (['KA', 'IN', 'KO'].includes(u.toks[index + 1]?.sym ?? '')) used.add(index + 1);
  }
  const body = contentTokens(u, used, new Set(['BE']));
  if (body.length > 0 && body.every((token) => GRAMMAR_ONLY.has(token.sym))) return null;
  const text = body
    .map((token) => token.text)
    .join(' ')
    .trim();
  return `take a note${text === '' ? '' : ` ${text}`}`;
};

// ---------------------------------------------------------------------------
// Copy: "इसे कॉपी करो", "जवाब कॉपी कर लो"
// ---------------------------------------------------------------------------

export const copyRule: Rule = (u) => {
  if (!u.has('COPY') || u.has('NO')) return null;
  if (
    !accounted(u, ['COPY', 'THAT', 'ANSWER', 'KA', 'KO', 'LAST', 'MY', 'ME', 'ALL', 'ON', 'TAKE'])
  ) {
    return null;
  }
  return u.has('ANSWER') ? 'copy the answer' : 'copy that';
};

import { levenshtein, similarity, typoBudget } from '../commands/text';
import { matchAliases, normalizeAppName, queryVariants, type AliasHit } from './appAliases';
import { isRecord } from './guards';
import type { RunningProcess } from './types';

/**
 * Processes Beekeeper never touches, not even with a polite close: the session and shell machinery,
 * security software and Beekeeper itself. (The current process is excluded by pid as well.)
 */
export const PROTECTED_PROCESSES: ReadonlySet<string> = new Set([
  'applicationframehost',
  'audiodg',
  'beekeeper',
  'conhost',
  'csrss',
  'ctfmon',
  'dllhost',
  'dwm',
  'fontdrvhost',
  'idle',
  'lockapp',
  'logonui',
  'lsaiso',
  'lsass',
  'msmpeng',
  'nissrv',
  'openconsole',
  'registry',
  'runtimebroker',
  'searchapp',
  'searchhost',
  'securityhealthservice',
  'securityhealthsystray',
  'services',
  'shellexperiencehost',
  'sihost',
  'smartscreen',
  'smss',
  'spoolsv',
  'startmenuexperiencehost',
  'svchost',
  'system',
  'taskhostw',
  'textinputhost',
  'unsecapp',
  'werfault',
  'wininit',
  'winlogon',
  'wmiprvse',
  'wudfhost',
]);

/** Windows may be closed politely, but the process is never terminated: ending it takes the desktop down. */
export const NO_FORCE_PROCESSES: ReadonlySet<string> = new Set(['explorer']);

/** Names a script can carry safely in its "pid:name|pid:name" target list. */
const SAFE_PROCESS_NAME = /^[^|:]+$/;
const MATCH_MIN_SCORE = 0.8;
const SELECTION_SLACK = 0.05;
const TITLE_SEPARATOR = /\s[-\u2013\u2014|]\s/;

export function isProtectedProcess(candidate: RunningProcess, selfPid: number): boolean {
  return candidate.pid === selfPid || PROTECTED_PROCESSES.has(candidate.name.toLowerCase());
}

/** Validates the reply of windows.ps1: one entry per window, `title` may be empty. */
export function parseWindowList(data: unknown): RunningProcess[] {
  if (!Array.isArray(data)) return [];
  const windows: RunningProcess[] = [];
  for (const item of data as unknown[]) {
    if (!isRecord(item)) continue;
    const { pid, name, title } = item;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue;
    if (typeof name !== 'string' || !SAFE_PROCESS_NAME.test(name)) continue;
    windows.push({ pid, name, title: typeof title === 'string' ? title : '' });
  }
  return windows;
}

function compactName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** "New Tab - Google Chrome" -> "google chrome". */
function titleTail(title: string): string {
  const parts = title.split(TITLE_SEPARATOR);
  return normalizeAppName(parts.at(-1) ?? '');
}

function scoreWindow(
  window: RunningProcess,
  variants: readonly string[],
  hits: readonly AliasHit[],
): number {
  const image = compactName(window.name);
  const tail = titleTail(window.title);
  let best = 0;

  for (const { alias, exact } of hits) {
    if (alias.processes?.some((name) => compactName(name) === image) === true) {
      best = Math.max(best, exact ? 1 : 0.9);
    }
    if (tail !== '' && alias.names.includes(tail)) best = Math.max(best, exact ? 0.9 : 0.85);
  }
  for (const variant of variants) {
    const query = variant.replaceAll(' ', '');
    if (query === image) best = Math.max(best, 1);
    if (query.length >= 5 && image.startsWith(query)) best = Math.max(best, 0.88);
    const budget = typoBudget(image.length);
    if (query.length >= 5 && budget > 0 && levenshtein(query, image, budget) <= budget) {
      best = Math.max(best, similarity(query, image));
    }
    if (tail !== '' && tail === variant) best = Math.max(best, 0.9);
  }
  return best;
}

export interface ProcessMatches {
  /** Distinct processes (one per pid) whose windows the user means. */
  matches: RunningProcess[];
  /** Set when the best match is a protected process and nothing else qualifies. */
  protectedName: string | null;
}

/**
 * Finds the running apps a spoken name refers to. Only the best-scoring group is returned (an app
 * with several windows or processes counts as one), and protected processes are never offered.
 */
export function matchProcesses(
  query: string,
  windows: readonly RunningProcess[],
  selfPid: number,
): ProcessMatches {
  const variants = queryVariants(query);
  if (variants.length === 0) return { matches: [], protectedName: null };
  const hits = matchAliases(variants);

  const scored = windows
    .map((window) => ({ window, score: scoreWindow(window, variants, hits) }))
    .filter((entry) => entry.score >= MATCH_MIN_SCORE);
  if (scored.length === 0) return { matches: [], protectedName: null };

  const top = Math.max(...scored.map((entry) => entry.score));
  const selected = scored.filter((entry) => entry.score >= top - SELECTION_SLACK);
  const allowed = new Map<number, RunningProcess>();
  let blocked: RunningProcess | null = null;
  for (const { window } of selected) {
    if (isProtectedProcess(window, selfPid)) blocked ??= window;
    else if (!allowed.has(window.pid)) allowed.set(window.pid, window);
  }
  return {
    matches: [...allowed.values()],
    protectedName: allowed.size === 0 && blocked !== null ? blocked.name : null,
  };
}

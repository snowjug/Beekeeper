import { join } from 'node:path';
import { evaluateMath } from '../commands/lib/math';
import type { CircleActions } from './service';

export interface CircleActionDeps {
  writeClipboardImage: (png: Buffer) => Promise<void>;
  writeClipboardText: (text: string) => Promise<void>;
  /** Opens a URL in the default handler (http(s) and mailto links built by the service only). */
  openUrl: (url: string) => Promise<void>;
  writeFile: (path: string, data: Buffer) => Promise<void>;
  ensureDir: (path: string) => void;
  scheduleReminder: (at: number, label: string) => void;
  picturesDir: string;
  now: () => Date;
}

const DEFAULT_REMINDER_HOUR = 9;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;
const OPENABLE = /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i;

/**
 * Epoch ms for an ISO date ("2026-11-10") or local date-time ("2026-11-10T15:30") found by smart
 * actions. Dates without a time remind at 09:00 local time. Past or invalid dates give null.
 */
export function reminderTimeFromIso(iso: string, now: Date): number | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour === undefined ? DEFAULT_REMINDER_HOUR : Number(hour),
    minute === undefined ? 0 : Number(minute),
  );
  const time = at.getTime();
  if (Number.isNaN(time) || at.getMonth() !== Number(month) - 1) return null;
  return time > now.getTime() ? time : null;
}

/** "1,234.5" style text for a calculation result. */
export function formatCalculation(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 }).format(value);
}

function timestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/** Clipboard / file / browser side effects of Circle to Search, with all I/O injected. */
export function createCircleActions(deps: CircleActionDeps): CircleActions {
  return {
    copyImage: (image) => deps.writeClipboardImage(image.toPNG()),
    copyText: (text) => deps.writeClipboardText(text),
    async savePng(png) {
      deps.ensureDir(deps.picturesDir);
      const path = join(deps.picturesDir, `Circle-${timestamp(deps.now())}.png`);
      await deps.writeFile(path, png);
      return path;
    },
    async openExternal(url) {
      if (!OPENABLE.test(url)) return false;
      try {
        await deps.openUrl(url);
        return true;
      } catch {
        return false;
      }
    },
    addReminder(iso, label) {
      const at = reminderTimeFromIso(iso, deps.now());
      if (at === null) return false;
      deps.scheduleReminder(at, label);
      return true;
    },
    calculate(expression) {
      const outcome = evaluateMath(expression.toLowerCase());
      return outcome.status === 'ok' ? formatCalculation(outcome.value) : null;
    },
  };
}

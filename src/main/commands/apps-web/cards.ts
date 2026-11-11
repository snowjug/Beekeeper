import type { CardAction, CardIcon, CardTone, CommandResult, StatusCard } from '@shared/cards';
import { SystemError } from '../../system/types';
import type { RunContext } from '../types';

export interface StatusOptions {
  tone: CardTone;
  icon: CardIcon;
  title: string;
  detail?: string;
  copyText?: string;
  openUrl?: string;
  actions?: CardAction[];
}

export function statusCard(ctx: RunContext, options: StatusOptions): StatusCard {
  return { id: ctx.newId(), createdAt: ctx.now.getTime(), kind: 'status', ...options };
}

/** Codes that mean "not possible here" rather than "something broke". */
const EXPECTED_FAILURES: ReadonlySet<SystemError['code']> = new Set([
  'unsupported',
  'not-found',
  'invalid-argument',
]);

/** A friendly card for a failed action; `action` completes "I couldn't ...". Never throws. */
export function failureResult(ctx: RunContext, action: string, error: unknown): CommandResult {
  ctx.logger.warn(`Could not ${action}`, error);
  const expected = error instanceof SystemError && EXPECTED_FAILURES.has(error.code);
  const detail =
    error instanceof SystemError
      ? error.message
      : 'Something unexpected went wrong. Please try again.';
  const card = statusCard(ctx, {
    tone: expected ? 'warning' : 'error',
    icon: expected ? 'warning' : 'error',
    title: `I couldn't ${action}`,
    detail,
  });
  return { cards: [card], speech: `Sorry, I couldn't ${action}.` };
}

/** `ui.openExternal` returned false or threw: the default browser could not be started. */
export function browserFailure(ctx: RunContext): CommandResult {
  const card = statusCard(ctx, {
    tone: 'error',
    icon: 'web',
    title: "I couldn't open your browser",
    detail: 'Check your default browser and try again.',
  });
  return { cards: [card], speech: "Sorry, I couldn't open your browser." };
}

/** Collapses whitespace and caps the length of text taken from the user. */
export function tidyQuery(text: string, maxLength = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Shortens text for speech so a long query is not read out in full. */
export function spoken(text: string, maxLength = 80): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

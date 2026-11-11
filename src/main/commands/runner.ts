import type { CommandResult, StatusCard } from '@shared/cards';
import type { ParsedIntent, RunContext } from './types';

const emptyResult = (): CommandResult => ({ cards: [] });

function safeId(ctx: RunContext): string {
  try {
    return ctx.newId();
  } catch {
    return `error-${ctx.now.getTime()}`;
  }
}

function errorResult(ctx: RunContext): CommandResult {
  const card: StatusCard = {
    kind: 'status',
    id: safeId(ctx),
    createdAt: ctx.now.getTime(),
    tone: 'error',
    icon: 'error',
    title: 'Something went wrong',
    detail: 'I ran into a problem while handling that. Please try again.',
  };
  return { cards: [card], speech: 'Sorry, something went wrong. Please try again.' };
}

/**
 * Runs the command behind `intent`. Never rejects: failures become a friendly error card
 * (details go to the log only) and an aborted run yields an empty result.
 */
export async function runIntent(intent: ParsedIntent, ctx: RunContext): Promise<CommandResult> {
  if (ctx.signal.aborted) return emptyResult();
  try {
    const result = await intent.command.run(intent.slots, ctx);
    return ctx.signal.aborted ? emptyResult() : result;
  } catch (error) {
    if (ctx.signal.aborted) return emptyResult();
    try {
      ctx.logger.error(`Command "${intent.command.id}" failed`, error);
    } catch {
      // A broken logger must not turn a handled failure into a crash.
    }
    return errorResult(ctx);
  }
}

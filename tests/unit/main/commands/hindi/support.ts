import type { CommandResult, ConversationTurn } from '@shared/cards';
import { allCommands, createCommandEngine, runIntent } from '@main/commands';
import { localizeResult, normalizeUtterance } from '@main/commands/hindi';
import type { ParsedIntent } from '@main/commands/types';
import { createFakeServices, NOW, parseContext, runContext, type FakeServices } from '../helpers';

export const engine = createCommandEngine({ modules: allCommands });

/** A Hindi / Hinglish utterance through the normaliser and the real command engine. */
export function understand(
  text: string,
  turns: readonly ConversationTurn[] = [],
): { spoken: ReturnType<typeof normalizeUtterance>; intent: ParsedIntent | null } {
  const spoken = normalizeUtterance(text);
  return { spoken, intent: engine.parse(spoken.text, parseContext(turns)) };
}

export interface Exchange {
  commandId: string;
  english: CommandResult;
  hindi: CommandResult;
}

/** Runs a Hindi utterance with fake services and returns the reply in English and in Hindi. */
export async function converse(
  text: string,
  services: FakeServices = createFakeServices(allCommands),
): Promise<Exchange> {
  const { intent } = understand(text);
  if (intent === null) throw new Error(`"${text}" was not understood`);
  const english = await runIntent(intent, runContext({ services }));
  const hindi = localizeResult(english, {
    commandId: intent.command.id,
    locale: 'hi',
    slots: intent.slots,
    now: NOW,
  });
  return { commandId: intent.command.id, english, hindi };
}

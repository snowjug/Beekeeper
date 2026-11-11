import type { Card, CardAction, CommandResult } from '@shared/cards';
import { LOCALIZERS, type LocalizeContext } from './commands';
import { translateFailure, translatePhrase } from './phrases';

export type { LocalizeContext } from './commands';
export { translateFailure, translatePhrase } from './phrases';

/** The Hindi of an English sentence, or the sentence itself when there is no translation. */
function hindiOf(text: string): string {
  if (text === '') return text;
  return translateFailure(text) ?? translatePhrase(text) ?? text;
}

function hindiActions(actions: CardAction[] | undefined): CardAction[] | undefined {
  return actions?.map((action) => ({ ...action, label: hindiOf(action.label) }));
}

/** Translates the fixed texts of a card (titles, details, button labels); data fields stay. */
function localizeCard(card: Card): Card {
  const actions = hindiActions(card.actions);
  const withActions = <T extends Card>(next: T): T =>
    actions === undefined ? next : { ...next, actions };
  switch (card.kind) {
    case 'status':
      return withActions({
        ...card,
        title: hindiOf(card.title),
        ...(card.detail === undefined ? {} : { detail: hindiOf(card.detail) }),
      });
    case 'confirm':
      return withActions({
        ...card,
        title: hindiOf(card.title),
        confirmLabel: hindiOf(card.confirmLabel),
        ...(card.detail === undefined ? {} : { detail: hindiOf(card.detail) }),
      });
    case 'countdown':
      return withActions({
        ...card,
        title: hindiOf(card.title),
        ...(card.detail === undefined ? {} : { detail: hindiOf(card.detail) }),
      });
    case 'notes':
      return withActions({ ...card, title: hindiOf(card.title) });
    default:
      return actions === undefined ? card : { ...card, actions };
  }
}

/**
 * Localises the reply of a command that ran for a Hindi utterance (speech and card text) into
 * natural Hindi. Replies without a translation are returned unchanged, so a missing template never
 * breaks an answer; card kinds, ids and data are never touched.
 */
export function localizeResult(result: CommandResult, context: LocalizeContext): CommandResult {
  if (context.locale !== 'hi') return result;
  try {
    const structured =
      context.commandId === null
        ? null
        : (LOCALIZERS[context.commandId]?.(result, context) ?? null);
    const base = structured ?? result;
    const localized: CommandResult = { ...base, cards: base.cards.map(localizeCard) };
    if (base.speech !== undefined) localized.speech = hindiOf(base.speech);
    return localized;
  } catch {
    return result;
  }
}

import type { AnswerCard, Card, CommandResult, ConversationTurn } from '@shared/cards';
import type { StreamEvent, SubmitResult } from '@shared/ipc/types';
import type { Logger } from '@shared/logger';
import type { Settings } from '@shared/settings';
import { runIntent, webSearchFallback, type CommandEngine } from '../commands';
import { localizeResult, normalizeUtterance } from '../commands/hindi';
import type { CommandServices, CommandSettings, RunContext } from '../commands/types';

/** Streams an AI answer into an AnswerCard (implemented by the Azure OpenAI service). */
export interface AnswerStreamer {
  /** True when Azure OpenAI is configured with an endpoint, deployment and key. */
  isConfigured: () => boolean;
  /** Model / deployment name shown on the card. */
  modelName: () => string;
  stream: (
    request: { cardId: string; prompt: string; turns: readonly ConversationTurn[] },
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ) => Promise<void>;
}

export interface AssistantServiceDeps {
  engine: CommandEngine;
  /** Late-bound: the UI bridge needs this service (cancel streams), so it is created afterwards. */
  getServices: () => CommandServices;
  getSettings: () => Settings;
  logger: Logger;
  streamer: AnswerStreamer | null;
  emitStream: (event: StreamEvent) => void;
  now?: () => Date;
  newId: () => string;
}

const MAX_TURNS = 5;
const SUMMARY_LENGTH = 120;

/** Text of the card the user most likely means by "copy that". */
export function answerTextOf(cards: readonly Card[]): string | null {
  for (const card of cards) {
    if (card.copyText) return card.copyText;
    if ((card.kind === 'text' || card.kind === 'answer') && card.markdown.trim()) {
      return card.markdown;
    }
  }
  return null;
}

/** One line for the history list. */
export function summarizeCards(cards: readonly Card[]): string {
  const first = cards[0];
  if (!first) return '';
  let text = '';
  switch (first.kind) {
    case 'status':
      text = first.detail ? `${first.title}. ${first.detail}` : first.title;
      break;
    case 'text':
    case 'answer':
      text = first.markdown;
      break;
    case 'weather':
      text = `${first.place}: ${Math.round(first.current.temp)}\u00b0, ${first.current.summary}`;
      break;
    default:
      text = first.copyText ?? first.kind;
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LENGTH ? `${flat.slice(0, SUMMARY_LENGTH - 1)}\u2026` : flat;
}

export function toCommandSettings(settings: Settings, aiConfigured: boolean): CommandSettings {
  return {
    units: settings.general.units,
    weatherLocation: settings.general.weatherLocation,
    aiConfigured,
  };
}

/**
 * Runs one assistant turn: parse -> command (or AI / web fallback) -> remember the turn (short
 * multi-turn context) -> history. It is pure TypeScript with injected dependencies. Hindi and
 * Hinglish are rewritten to the English command form for parsing and answered in Hindi; the turn
 * and the history keep the words as they were said.
 */
export class AssistantService {
  private turns: ConversationTurn[] = [];
  private lastAnswer: string | null = null;
  /** Controller of the run that is being executed (a new request aborts the previous one). */
  private abort: AbortController | null = null;
  /** Controller of the run that owns the AI stream that is currently being written. */
  private streamAbort: AbortController | null = null;
  private activeStreams = 0;

  constructor(private readonly deps: AssistantServiceDeps) {}

  getLastAnswerText(): string | null {
    return this.lastAnswer;
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turns;
  }

  /**
   * Aborts a streaming answer; returns how many streams were running. It never aborts the run that
   * is executing right now: "stop" / "never mind" calls this from inside its own run, and aborting
   * that run would drop its result (closing the bar).
   */
  cancelStreams(): number {
    const running = this.activeStreams;
    this.streamAbort?.abort();
    this.streamAbort = null;
    return running;
  }

  async submit(text: string, source: 'text' | 'voice' | 'chip' | 'circle'): Promise<SubmitResult> {
    const now = (this.deps.now ?? (() => new Date()))();
    const settings = this.deps.getSettings();
    const services = this.deps.getServices();

    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;

    const spoken = normalizeUtterance(text);
    const parseContext = { now, turns: this.turns };
    const intent =
      this.deps.engine.parse(spoken.text, parseContext) ??
      (spoken.changed ? this.deps.engine.parse(text, parseContext) : null);
    const context: RunContext = {
      now,
      turns: this.turns,
      settings: toCommandSettings(settings, this.deps.streamer?.isConfigured() ?? false),
      services,
      logger: this.deps.logger,
      signal: controller.signal,
      newId: this.deps.newId,
    };

    let result: CommandResult = intent
      ? await runIntent(intent, context)
      : await this.fallback(text, context, settings);
    if (spoken.locale === 'hi') {
      result = localizeResult(result, {
        commandId: intent?.command.id ?? null,
        locale: 'hi',
        slots: intent?.slots,
        now,
      });
    }

    const turn: ConversationTurn = {
      id: this.deps.newId(),
      at: now.getTime(),
      text,
      commandId: intent?.command.id ?? null,
      ...(intent ? { slots: intent.slots } : {}),
      ...(result.context ? { context: result.context } : {}),
    };
    this.turns = [...this.turns, turn].slice(-MAX_TURNS);

    const answer = answerTextOf(result.cards);
    if (answer) this.lastAnswer = answer;

    if (settings.privacy.saveHistory) {
      services.history.add({
        at: now.getTime(),
        text,
        source: source === 'chip' ? 'text' : source,
        commandId: turn.commandId,
        summary: summarizeCards(result.cards),
      });
    }

    return {
      turnId: turn.id,
      cards: result.cards,
      ...(result.speech ? { speech: result.speech } : {}),
      locale: spoken.locale,
      ...(result.autoCloseMs !== undefined ? { autoCloseMs: result.autoCloseMs } : {}),
      ...(result.pin ? { pin: true } : {}),
      ...(result.closeNow ? { closeNow: true } : {}),
    };
  }

  private async fallback(
    text: string,
    context: RunContext,
    settings: Settings,
  ): Promise<CommandResult> {
    const streamer = this.deps.streamer;
    if (settings.ai.useAzureOpenAi && streamer?.isConfigured()) {
      const cardId = this.deps.newId();
      const card: AnswerCard = {
        kind: 'answer',
        id: cardId,
        createdAt: context.now.getTime(),
        markdown: '',
        streaming: true,
        model: streamer.modelName(),
      };
      this.activeStreams += 1;
      const owner = this.abort;
      this.streamAbort = owner;
      void streamer
        .stream({ cardId, prompt: text, turns: this.turns }, context.signal, this.deps.emitStream)
        .catch((error: unknown) => {
          this.deps.logger.error('AI answer failed', error);
          this.deps.emitStream({ cardId, error: 'The answer could not be completed.' });
        })
        .finally(() => {
          this.activeStreams = Math.max(0, this.activeStreams - 1);
          if (this.streamAbort === owner) this.streamAbort = null;
        });
      return { cards: [card], pin: true };
    }
    return webSearchFallback(text, context);
  }
}

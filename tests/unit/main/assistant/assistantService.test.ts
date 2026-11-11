import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '@shared/cards';
import { DEFAULT_SETTINGS, SettingsSchema } from '@shared/settings';
import { allCommands, createCommandEngine } from '@main/commands';
import {
  answerTextOf,
  AssistantService,
  summarizeCards,
  toCommandSettings,
  type AnswerStreamer,
} from '@main/assistant/assistantService';
import { createFakeLogger, createFakeServices, NOW } from '../commands/helpers';

function setup(
  options: { streamer?: AnswerStreamer | null; ai?: boolean; history?: boolean } = {},
) {
  const historyAdd = vi.fn((entry: Omit<HistoryEntry, 'id'>) => ({ id: 'history-1', ...entry }));
  const services = createFakeServices([], {
    history: { add: historyAdd, list: () => [], clear: () => 0 },
  });
  const logger = createFakeLogger();
  const emitStream = vi.fn();
  const settings = SettingsSchema.parse({
    ai: { useAzureOpenAi: options.ai ?? false },
    privacy: { saveHistory: options.history ?? true },
  });
  let counter = 0;
  const service = new AssistantService({
    engine: createCommandEngine({ modules: allCommands, logger }),
    getServices: () => services,
    getSettings: () => settings,
    logger,
    streamer: options.streamer ?? null,
    emitStream,
    now: () => NOW,
    newId: () => `id-${(counter += 1)}`,
  });
  // "stop" calls ui.cancelPending(): wire it to the service like the real UI bridge does.
  services.ui.cancelPending.mockImplementation(() => ({
    confirmations: 0,
    streams: service.cancelStreams(),
  }));
  return { service, services, historyAdd, emitStream, logger };
}

describe('AssistantService.submit', () => {
  it('runs a command, remembers the turn and writes history', async () => {
    const { service, historyAdd } = setup();
    const result = await service.submit('calculate 15% of 2400', 'text');
    expect(result.cards[0]).toMatchObject({ kind: 'calc' });
    expect(service.getTurns()).toHaveLength(1);
    expect(service.getTurns()[0]).toMatchObject({
      text: 'calculate 15% of 2400',
      commandId: expect.any(String) as string,
    });
    expect(historyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'calculate 15% of 2400', source: 'text' }),
    );
    expect(service.getLastAnswerText()).toContain('360');
  });

  it('does not write history when the user turned it off, and maps chips to text', async () => {
    const off = setup({ history: false });
    await off.service.submit('what time is it', 'text');
    expect(off.historyAdd).not.toHaveBeenCalled();

    const on = setup();
    await on.service.submit('what time is it', 'chip');
    expect(on.historyAdd).toHaveBeenCalledWith(expect.objectContaining({ source: 'text' }));
  });

  it('keeps only the last five turns for follow-ups', async () => {
    const { service } = setup();
    for (let index = 0; index < 7; index += 1)
      await service.submit(`calculate ${index} + 1`, 'text');
    expect(service.getTurns()).toHaveLength(5);
  });

  it('falls back to a web search when nothing matches and no AI is configured', async () => {
    const { service } = setup();
    const result = await service.submit('purple monkey dishwasher unicorn', 'text');
    expect(result.cards[0]?.kind).toBe('search');
    expect(service.getTurns()[0]?.commandId).toBeNull();
  });
});

describe('AI fallback streaming', () => {
  function streamer(onStream: AnswerStreamer['stream']): AnswerStreamer {
    return { isConfigured: () => true, modelName: () => 'gpt-4o', stream: onStream };
  }

  it('returns a pinned, streaming answer card and streams into it', async () => {
    const stream = vi.fn(
      (request: { cardId: string }, _signal: AbortSignal, emit: (e: unknown) => void) => {
        emit({ cardId: request.cardId, delta: 'Hello' });
        emit({ cardId: request.cardId, done: true });
        return Promise.resolve();
      },
    );
    const { service, emitStream } = setup({
      streamer: streamer(stream as AnswerStreamer['stream']),
      ai: true,
    });
    const result = await service.submit('tell me something interesting', 'text');
    expect(result.cards[0]).toMatchObject({ kind: 'answer', streaming: true, model: 'gpt-4o' });
    expect(result.pin).toBe(true);
    await Promise.resolve();
    expect(stream).toHaveBeenCalledOnce();
    expect(emitStream).toHaveBeenCalledWith(expect.objectContaining({ delta: 'Hello' }));
  });

  it('reports a failing stream on the card instead of throwing', async () => {
    const { service, emitStream, logger } = setup({
      streamer: streamer(() => Promise.reject(new Error('boom'))),
      ai: true,
    });
    const result = await service.submit('tell me something interesting', 'text');
    const cardId = result.cards[0]?.id;
    await new Promise((done) => setTimeout(done, 0));
    expect(emitStream).toHaveBeenCalledWith({
      cardId,
      error: 'The answer could not be completed.',
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it('"stop" cancels the running stream without aborting its own run (the bar still closes)', async () => {
    let signal: AbortSignal | undefined;
    const running = streamer((_request, abortSignal) => {
      signal = abortSignal;
      return new Promise(() => undefined);
    });
    const { service } = setup({ streamer: running, ai: true });
    await service.submit('tell me something interesting', 'text');
    expect(signal?.aborted).toBe(false);

    const stop = await service.submit('stop', 'text');
    expect(signal?.aborted).toBe(true);
    expect(stop.closeNow).toBe(true);
  });

  it('a new request cancels the previous stream', async () => {
    let signal: AbortSignal | undefined;
    const running = streamer((_request, abortSignal) => {
      signal = abortSignal;
      return new Promise(() => undefined);
    });
    const { service } = setup({ streamer: running, ai: true });
    await service.submit('tell me something interesting', 'text');
    await service.submit('what time is it', 'text');
    expect(signal?.aborted).toBe(true);
  });

  it('cancelStreams reports how many streams were running', async () => {
    const { service } = setup({
      streamer: streamer(() => new Promise(() => undefined)),
      ai: true,
    });
    expect(service.cancelStreams()).toBe(0);
    await service.submit('tell me something interesting', 'text');
    expect(service.cancelStreams()).toBe(1);
  });
});

describe('helpers', () => {
  it('finds the text a user means by "copy that"', () => {
    expect(
      answerTextOf([
        { kind: 'status', id: '1', createdAt: 0, tone: 'neutral', icon: 'check', title: 'ok' },
        { kind: 'text', id: '2', createdAt: 0, markdown: 'hello' },
      ]),
    ).toBe('hello');
    expect(
      answerTextOf([{ kind: 'text', id: '1', createdAt: 0, markdown: '   ', copyText: 'copied' }]),
    ).toBe('copied');
    expect(answerTextOf([])).toBeNull();
  });

  it('summarises the first card for the history list', () => {
    expect(summarizeCards([])).toBe('');
    expect(
      summarizeCards([
        {
          kind: 'status',
          id: '1',
          createdAt: 0,
          tone: 'success',
          icon: 'check',
          title: 'Done',
          detail: 'Opened',
        },
      ]),
    ).toBe('Done. Opened');
    const long = 'word '.repeat(60);
    const summary = summarizeCards([{ kind: 'text', id: '1', createdAt: 0, markdown: long }]);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith('\u2026')).toBe(true);
  });

  it('maps settings to the command view of them', () => {
    expect(toCommandSettings(DEFAULT_SETTINGS, true)).toEqual({
      units: 'metric',
      weatherLocation: { mode: 'auto', city: '' },
      aiConfigured: true,
    });
  });
});

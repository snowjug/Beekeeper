import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, TimerCard } from '@shared/cards';
import { SettingsSchema } from '@shared/settings';
import { allCommands, createCommandEngine, type CommandEngine } from '@main/commands';
import { AssistantService, type AnswerStreamer } from '@main/assistant/assistantService';
import { createFakeLogger, createFakeServices, NOW } from '../commands/helpers';

function setup(
  options: { streamer?: AnswerStreamer | null; engine?: CommandEngine; ai?: boolean } = {},
) {
  const historyAdd = vi.fn((entry: Omit<HistoryEntry, 'id'>) => ({ id: 'history-1', ...entry }));
  const startTimer = vi.fn((request: { durationMs: number; label?: string }) => ({
    id: 'timer-1',
    type: 'timer' as const,
    label: request.label ?? 'Timer',
    durationMs: request.durationMs,
    startedAt: NOW.getTime(),
    endsAt: NOW.getTime() + request.durationMs,
    state: 'running' as const,
  }));
  const base = createFakeServices(allCommands);
  const openExternal = vi.fn(() => Promise.resolve(true));
  const services = {
    ...base,
    history: { add: historyAdd, list: () => [], clear: () => 0 },
    timers: { ...base.timers, startTimer },
    ui: { ...base.ui, openExternal },
  };
  const logger = createFakeLogger();
  const settings = SettingsSchema.parse({ ai: { useAzureOpenAi: options.ai ?? false } });
  let counter = 0;
  const service = new AssistantService({
    engine: options.engine ?? createCommandEngine({ modules: allCommands, logger }),
    getServices: () => services,
    getSettings: () => settings,
    logger,
    streamer: options.streamer ?? null,
    emitStream: vi.fn(),
    now: () => NOW,
    newId: () => `id-${(counter += 1)}`,
  });
  return { service, historyAdd, startTimer, openExternal };
}

describe('AssistantService with Hindi', () => {
  it('understands a Hindi command, answers in Hindi and says so', async () => {
    const { service, startTimer } = setup();
    const result = await service.submit('5 मिनट का टाइमर लगाओ', 'voice');

    expect(result.locale).toBe('hi');
    expect(result.speech).toBe('ठीक है, 5 मिनट का टाइमर शुरू कर दिया।');
    const [card] = result.cards;
    expect(card?.kind).toBe('timer');
    expect((card as TimerCard).label).toBe('टाइमर');
    expect(startTimer).toHaveBeenCalledWith({ durationMs: 300_000 });
  });

  it('remembers what was said, not the English it was turned into', async () => {
    const { service, historyAdd } = setup();
    await service.submit('5 मिनट का टाइमर लगाओ', 'voice');

    expect(service.getTurns()[0]).toMatchObject({
      text: '5 मिनट का टाइमर लगाओ',
      commandId: 'timer',
      slots: { action: 'start', durationMs: 300_000 },
    });
    expect(historyAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '5 मिनट का टाइमर लगाओ',
        source: 'voice',
        commandId: 'timer',
      }),
    );
  });

  it('writes the history summary in Hindi', async () => {
    const { service, historyAdd } = setup();
    await service.submit('नोट करो कि दूध लाना है', 'text');
    expect(historyAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'नोट करो कि दूध लाना है',
        summary: expect.stringContaining('नोट सेव हो गया') as string,
      }),
    );
  });

  it('keeps English exactly as it was', async () => {
    const { service } = setup();
    const result = await service.submit('set a timer for 5 minutes', 'text');
    expect(result.locale).toBe('en');
    expect(result.speech).toBe('Timer set for 5 minutes');
    expect((result.cards[0] as TimerCard).label).toBe('Timer');
    expect(service.getTurns()[0]?.text).toBe('set a timer for 5 minutes');
  });

  it('follows up a question in Hindi with the answer in Hindi', async () => {
    const { service, startTimer } = setup();
    const asked = await service.submit('टाइमर लगाओ', 'voice');
    expect(asked.speech).toBe('टाइमर कितनी देर के लिए चलाऊँ?');

    const answered = await service.submit('पाँच मिनट', 'voice');
    expect(answered.speech).toBe('ठीक है, 5 मिनट का टाइमर शुरू कर दिया।');
    expect(startTimer).toHaveBeenCalledWith({ durationMs: 300_000 });
    expect(service.getTurns().map((turn) => turn.text)).toEqual(['टाइमर लगाओ', 'पाँच मिनट']);
  });

  it('asks for confirmation in Hindi without changing what the confirmation does', async () => {
    const { service } = setup();
    const result = await service.submit('कंप्यूटर बंद करो', 'voice');
    expect(result.speech).toBe('क्या आपका पीसी बंद कर दूँ? कृपया पुष्टि कीजिए।');
    expect(result.cards[0]).toMatchObject({
      kind: 'confirm',
      id: 'confirm-card',
      confirmId: 'confirm-1',
      title: 'क्या इस पीसी को बंद कर दूँ?',
      confirmLabel: 'बंद करें',
    });
  });

  it('closes the bar after "stop" like it does in English', async () => {
    const { service } = setup();
    const result = await service.submit('रुको', 'voice');
    expect(result.closeNow).toBe(true);
    expect(result.locale).toBe('hi');
  });

  it('searches the web for what was said when nothing matches, and tells the user in Hindi', async () => {
    const { service, openExternal, historyAdd } = setup();
    const result = await service.submit('ताजमहल कितना पुराना है', 'voice');

    expect(openExternal).toHaveBeenCalledWith(
      `https://www.bing.com/search?q=${encodeURIComponent('ताजमहल कितना पुराना है')}`,
    );
    expect(result.locale).toBe('hi');
    expect(result.speech).toBe('वेब पर "ताजमहल कितना पुराना है" खोज रहा हूँ');
    expect(result.cards[0]).toMatchObject({ kind: 'search', query: 'ताजमहल कितना पुराना है' });
    expect(service.getTurns()[0]).toMatchObject({
      text: 'ताजमहल कितना पुराना है',
      commandId: null,
    });
    expect(historyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'ताजमहल कितना पुराना है', commandId: null }),
    );
  });

  it('asks the AI with the words the user said', async () => {
    const stream = vi.fn(() => Promise.resolve());
    const streamer: AnswerStreamer = {
      isConfigured: () => true,
      modelName: () => 'gpt-4o',
      stream,
    };
    const { service } = setup({ streamer, ai: true });
    const result = await service.submit('ताजमहल कितना पुराना है', 'voice');

    expect(result.locale).toBe('hi');
    expect(result.cards[0]).toMatchObject({ kind: 'answer', streaming: true, markdown: '' });
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'ताजमहल कितना पुराना है' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to the original words when the rewritten command is not understood', async () => {
    const real = createCommandEngine({ modules: allCommands });
    const engine: CommandEngine = {
      ...real,
      parse: (text, context) =>
        text === 'volume badha do' ? real.parse('volume up', context) : null,
    };
    const { service } = setup({ engine });
    const result = await service.submit('volume badha do', 'text');
    expect(result.locale).toBe('hi');
    expect(result.speech).toBe('आवाज़ 50 प्रतिशत है।');
    expect(service.getTurns()[0]).toMatchObject({ text: 'volume badha do', commandId: 'volume' });
  });

  it('reads Hinglish and Devanagari digits too', async () => {
    const { service, startTimer } = setup();
    expect((await service.submit('kal subah saat baje alarm laga do', 'voice')).locale).toBe('hi');
    await service.submit('५ मिनट का टाइमर लगाओ', 'voice');
    expect(startTimer).toHaveBeenCalledWith({ durationMs: 300_000 });
  });
});

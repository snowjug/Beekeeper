import { describe, expect, it, vi } from 'vitest';
import type { StatusCard } from '@shared/cards';
import * as publicApi from '@main/commands';
import { createCommandEngine } from '@main/commands/engine';
import { webSearchFallback } from '@main/commands/fallback';
import { assistantCommands } from '@main/commands/groups/assistant';
import { infoCommands } from '@main/commands/groups/info';
import { newId } from '@main/commands/ids';
import { allCommands, buildRegistry } from '@main/commands/registry';
import { runIntent } from '@main/commands/runner';
import { normalizeInput } from '@main/commands/text';
import { defineCommand } from '@main/commands/types';
import type { AnyCommandModule, CommandGroup, ParsedIntent } from '@main/commands/types';
import {
  NOW,
  createFakeLogger,
  createFakeServices,
  parseContext,
  runContext,
  turn,
} from './helpers';

interface FakeOptions {
  score?: number | null;
  priority?: number;
  group?: CommandGroup;
  run?: AnyCommandModule['run'];
}

function fake(id: string, number: number, options: FakeOptions = {}): AnyCommandModule {
  const { score = 0.9, priority, group = 'info', run } = options;
  return defineCommand({
    id,
    number,
    group,
    title: id,
    icon: 'info',
    examples: [id],
    ...(priority === undefined ? {} : { priority }),
    match: () => (score === null ? null : { slots: { from: id }, score }),
    run: run ?? (() => ({ cards: [] })),
  });
}

describe('createCommandEngine: choosing a command', () => {
  it('picks the highest score', () => {
    const engine = createCommandEngine({
      modules: [
        fake('low', 1, { score: 0.6 }),
        fake('high', 2, { score: 0.9 }),
        fake('mid', 3, { score: 0.7 }),
      ],
    });
    const intent = engine.parse('anything', parseContext());
    expect(intent?.command.id).toBe('high');
    expect(intent).toMatchObject({ slots: { from: 'high' }, score: 0.9 });
  });

  it('breaks ties by priority, then by the lower command number', () => {
    const byPriority = createCommandEngine({
      modules: [fake('first', 1, { score: 0.9 }), fake('urgent', 5, { score: 0.9, priority: 3 })],
    });
    expect(byPriority.parse('x', parseContext())?.command.id).toBe('urgent');

    const byNumber = createCommandEngine({
      modules: [fake('later', 9), fake('earlier', 2), fake('middle', 5)],
    });
    expect(byNumber.parse('x', parseContext())?.command.id).toBe('earlier');
  });

  it('prefers a better score over a better priority', () => {
    const engine = createCommandEngine({
      modules: [
        fake('exact', 8, { score: 0.95 }),
        fake('urgent', 1, { score: 0.9, priority: 100 }),
      ],
    });
    expect(engine.parse('x', parseContext())?.command.id).toBe('exact');
  });

  it('treats scores that differ only by float noise as equal', () => {
    const engine = createCommandEngine({
      modules: [fake('a', 5, { score: 0.6 + 0.3 }), fake('b', 2, { score: 0.9 })],
    });
    expect(engine.parse('x', parseContext())?.command.id).toBe('b');
  });

  it('ignores matches below the minimum score', () => {
    const modules = [fake('weak', 1, { score: 0.4 })];
    expect(createCommandEngine({ modules }).parse('x', parseContext())).toBeNull();
    expect(
      createCommandEngine({ modules, minScore: 0.3 }).parse('x', parseContext()),
    ).not.toBeNull();
    expect(
      createCommandEngine({ modules: [fake('ok', 1, { score: 0.5 })] }).parse('x', parseContext()),
    ).not.toBeNull();
  });

  it('ignores non-numeric scores and clamps scores above 1', () => {
    expect(
      createCommandEngine({ modules: [fake('nan', 1, { score: Number.NaN })] }).parse(
        'x',
        parseContext(),
      ),
    ).toBeNull();
    const intent = createCommandEngine({ modules: [fake('big', 1, { score: 7 })] }).parse(
      'x',
      parseContext(),
    );
    expect(intent?.score).toBe(1);
  });

  it('returns null when nothing matches or the input is empty', () => {
    const matcher = vi.fn(() => null);
    const module = defineCommand({
      id: 'quiet',
      number: 1,
      group: 'info',
      title: 'quiet',
      icon: 'info',
      examples: ['q'],
      match: matcher,
      run: () => ({ cards: [] }),
    });
    const engine = createCommandEngine({ modules: [module] });
    expect(engine.parse('hello', parseContext())).toBeNull();
    expect(matcher).toHaveBeenCalledTimes(1);
    expect(engine.parse('', parseContext())).toBeNull();
    expect(engine.parse('   ', parseContext())).toBeNull();
    expect(engine.parse('Hey Beekeeper', parseContext())).toBeNull();
    expect(matcher).toHaveBeenCalledTimes(1);
  });

  it('hands matchers the normalised input and the conversation context', () => {
    const matcher = vi.fn<AnyCommandModule['match']>(() => null);
    const module = defineCommand({
      id: 'spy',
      number: 1,
      group: 'info',
      title: 'spy',
      icon: 'info',
      examples: ['s'],
      match: matcher,
      run: () => ({ cards: [] }),
    });
    const context = parseContext([turn('weather', 'weather')]);
    const text = 'Hey Beekeeper, What time is it please?';
    createCommandEngine({ modules: [module] }).parse(text, context);
    expect(matcher).toHaveBeenCalledWith(normalizeInput(text), context);
    const [input] = matcher.mock.calls[0] ?? [];
    expect(input).toMatchObject({ raw: text, text: 'what time is it' });
  });

  it('carries the normalised input on the intent', () => {
    const intent = createCommandEngine({ modules: [fake('a', 1)] }).parse(
      ' Ok Beekeeper, A ',
      parseContext(),
    );
    expect(intent?.input.text).toBe('a');
  });

  it('keeps going when one matcher throws, and logs it', () => {
    const logger = createFakeLogger();
    const broken = defineCommand({
      id: 'broken',
      number: 1,
      group: 'info',
      title: 'broken',
      icon: 'info',
      examples: ['b'],
      match: () => {
        throw new Error('kaboom');
      },
      run: () => ({ cards: [] }),
    });
    const engine = createCommandEngine({ modules: [broken, fake('fine', 2)], logger });
    expect(engine.parse('x', parseContext())?.command.id).toBe('fine');
    expect(logger.warn).toHaveBeenCalledWith('Command "broken" failed to match', expect.any(Error));
  });

  it('does not need a logger', () => {
    const broken = defineCommand({
      id: 'broken',
      number: 1,
      group: 'info',
      title: 'broken',
      icon: 'info',
      examples: ['b'],
      match: () => {
        throw new Error('kaboom');
      },
      run: () => ({ cards: [] }),
    });
    expect(createCommandEngine({ modules: [broken] }).parse('x', parseContext())).toBeNull();
  });

  it('exposes its modules', () => {
    const modules = [fake('a', 1), fake('b', 2)];
    expect(createCommandEngine({ modules }).modules).toBe(modules);
  });
});

describe('routing between the info and assistant commands', () => {
  const engine = createCommandEngine({ modules: [...infoCommands, ...assistantCommands] });
  const idFor = (text: string) => engine.parse(text, parseContext())?.command.id ?? null;

  it.each([
    ['what time is it', 'datetime'],
    ['what time is it in tokyo', 'datetime'],
    ["what's the date", 'datetime'],
    ['weather', 'weather'],
    ['what is the weather', 'weather'],
    ['how hot is it', 'weather'],
    ['will it rain tomorrow', 'weather'],
    ['battery status', 'battery'],
    ['system info', 'system-info'],
    ['how much ram do i have', 'system-info'],
    ['calculate 15% of 2400', 'calculate'],
    ['5 times 7', 'calculate'],
    ['what is 2 to the power of 10', 'calculate'],
    ["what's 5 km in miles", 'convert'],
    ['what is 100 fahrenheit in celsius', 'convert'],
    ['10 pounds in kg', 'convert'],
    ['define serendipity', 'define'],
    ['what does ephemeral mean', 'define'],
    ['circle to search', 'circle-to-search'],
    ['search my screen', 'circle-to-search'],
    ['open settings', 'settings-and-help'],
    ['help', 'settings-and-help'],
    ['what can you do', 'settings-and-help'],
    ['stop', 'stop'],
    ['never mind', 'stop'],
    ['close', 'stop'],
  ])('"%s" goes to %s', (text, id) => {
    expect(idFor(text)).toBe(id);
  });

  it.each([
    'search for cats',
    'google the weather in paris',
    'open notepad',
    'open wifi settings',
    'open the settings app',
    'close notepad',
    'stop the timer',
    'cancel my timer',
    'set a timer for 5 minutes',
    'remind me in 10 minutes to call mom',
    'volume up',
    'take a note buy milk',
    'play despacito on youtube',
    'who painted the mona lisa',
    'tell me a joke',
    'what is love',
    '',
  ])('leaves "%s" to others', (text) => {
    expect(idFor(text)).toBeNull();
  });

  it('answers follow-ups only right after a weather answer', () => {
    const afterWeather = parseContext([
      turn('weather', 'weather in paris', { context: { focusDay: 0 } }),
    ]);
    expect(engine.parse('what about tomorrow', afterWeather)?.command.id).toBe('weather');
    expect(engine.parse('what about tomorrow', parseContext())).toBeNull();
  });

  it('routes every advertised example to the command that advertises it', () => {
    for (const command of [...infoCommands, ...assistantCommands]) {
      for (const example of command.examples) {
        expect(engine.parse(example, parseContext())?.command.id, example).toBe(command.id);
      }
    }
  });
});

describe('runIntent', () => {
  function intentFor(run: AnyCommandModule['run'], id = 'probe'): ParsedIntent {
    return {
      command: fake(id, 1, { run }),
      slots: { from: id },
      score: 0.9,
      input: normalizeInput('probe'),
    };
  }

  it('returns what the command produced, awaiting async commands', async () => {
    const ctx = runContext();
    const sync = await runIntent(
      intentFor(() => ({ cards: [], speech: 'sync' })),
      ctx,
    );
    expect(sync.speech).toBe('sync');
    const async = await runIntent(
      intentFor(() => Promise.resolve({ cards: [], speech: 'async' })),
      ctx,
    );
    expect(async.speech).toBe('async');
  });

  it('passes the slots and the context to the command', async () => {
    const ctx = runContext();
    const run = vi.fn(() => ({ cards: [] }));
    await runIntent(intentFor(run), ctx);
    expect(run).toHaveBeenCalledWith({ from: 'probe' }, ctx);
  });

  it.each([
    [
      'throws synchronously',
      () => {
        throw new Error('secret stack detail');
      },
    ],
    ['rejects', () => Promise.reject(new Error('secret stack detail'))],
  ])('turns a command that %s into a friendly error card', async (_label, run) => {
    const logger = createFakeLogger();
    const result = await runIntent(intentFor(run, 'weather'), runContext({ logger }));

    expect(result.cards).toHaveLength(1);
    const card = result.cards[0] as StatusCard;
    expect(card).toMatchObject({
      kind: 'status',
      id: 'id-1',
      createdAt: NOW.getTime(),
      tone: 'error',
      icon: 'error',
      title: 'Something went wrong',
    });
    expect(result.speech).toBe('Sorry, something went wrong. Please try again.');
    expect(JSON.stringify(result)).not.toMatch(/secret|stack|Error/);
    expect(logger.error).toHaveBeenCalledWith('Command "weather" failed', expect.any(Error));
  });

  it('returns an empty result when the run was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(() => ({ cards: [], speech: 'late' }));
    const result = await runIntent(intentFor(run), runContext({ signal: controller.signal }));
    expect(result).toEqual({ cards: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it('discards the answer of a command that finished after the user said stop', async () => {
    const controller = new AbortController();
    const result = await runIntent(
      intentFor(() => {
        controller.abort();
        return { cards: [], speech: 'too late' };
      }),
      runContext({ signal: controller.signal }),
    );
    expect(result).toEqual({ cards: [] });
  });

  it('stays quiet about errors that happen after an abort', async () => {
    const controller = new AbortController();
    const logger = createFakeLogger();
    const result = await runIntent(
      intentFor(() => {
        controller.abort();
        throw new Error('aborted fetch');
      }),
      runContext({ signal: controller.signal, logger }),
    );
    expect(result).toEqual({ cards: [] });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('survives a logger and an id generator that throw', async () => {
    const logger = createFakeLogger();
    logger.error.mockImplementation(() => {
      throw new Error('log failure');
    });
    const ctx = {
      ...runContext({ logger }),
      newId: () => {
        throw new Error('no ids');
      },
    };
    const result = await runIntent(
      intentFor(() => {
        throw new Error('boom');
      }),
      ctx,
    );
    expect(result.cards[0]).toMatchObject({ id: `error-${NOW.getTime()}`, tone: 'error' });
  });
});

describe('webSearchFallback', () => {
  it('searches Bing in the default browser and shows what it did', async () => {
    const services = createFakeServices();
    const result = await webSearchFallback('who painted the mona lisa', runContext({ services }));
    const url = 'https://www.bing.com/search?q=who%20painted%20the%20mona%20lisa';
    expect(services.ui.openExternal).toHaveBeenCalledWith(url);
    expect(result.cards).toEqual([
      {
        kind: 'search',
        id: 'id-1',
        createdAt: NOW.getTime(),
        engine: 'web',
        query: 'who painted the mona lisa',
        url,
        openUrl: url,
      },
    ]);
    expect(result.speech).toBe('Searching the web for who painted the mona lisa');
    expect(result.autoCloseMs).toBe(3000);
  });

  it('encodes the query and tidies whitespace', async () => {
    const services = createFakeServices();
    await webSearchFallback('  c# & f#:   what\tis it?  ', runContext({ services }));
    expect(services.ui.openExternal).toHaveBeenCalledWith(
      'https://www.bing.com/search?q=c%23%20%26%20f%23%3A%20what%20is%20it%3F',
    );
    await webSearchFallback('café ☕', runContext({ services }));
    expect(services.ui.openExternal).toHaveBeenLastCalledWith(
      'https://www.bing.com/search?q=caf%C3%A9%20%E2%98%95',
    );
  });

  it('keeps the URL short enough for the browser bridge', async () => {
    const services = createFakeServices();
    const result = await webSearchFallback('你好'.repeat(300), runContext({ services }));
    const [url] = services.ui.openExternal.mock.calls[0] ?? [''];
    expect(url.length).toBeLessThan(2048);
    expect(result.cards[0]).toMatchObject({ kind: 'search' });
  });

  it('does not read a whole paragraph aloud', async () => {
    const result = await webSearchFallback('word '.repeat(50).trim(), runContext());
    expect(result.speech?.endsWith('…')).toBe(true);
    expect(result.speech?.length).toBeLessThan(120);
  });

  it('asks again when there is nothing to search for', async () => {
    const services = createFakeServices();
    const result = await webSearchFallback('   ', runContext({ services }));
    expect(services.ui.openExternal).not.toHaveBeenCalled();
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'warning',
      title: "I didn't catch that",
    });
  });

  it.each([
    ['refuses the URL', () => Promise.resolve(false)],
    ['cannot launch the browser', () => Promise.reject(new Error('no browser'))],
  ])('reports it when the system %s', async (_label, openExternal) => {
    const services = createFakeServices();
    services.ui.openExternal.mockImplementation(openExternal);
    const logger = createFakeLogger();
    const result = await webSearchFallback('cats', runContext({ services, logger }));
    expect(result.cards[0]).toMatchObject({
      kind: 'status',
      tone: 'error',
      title: "I couldn't open your browser",
    });
    expect(result.cards.some((card) => card.kind === 'search')).toBe(false);
  });
});

describe('registry', () => {
  it('flattens the groups and sorts by command number', () => {
    const registry = buildRegistry([[fake('c', 30), fake('a', 2)], [], [fake('b', 10)]]);
    expect(registry.map((module) => module.id)).toEqual(['a', 'b', 'c']);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('rejects duplicate ids and duplicate numbers at start-up', () => {
    expect(() => buildRegistry([[fake('same', 1)], [fake('same', 2)]])).toThrow(
      'Duplicate command id "same"',
    );
    expect(() => buildRegistry([[fake('one', 5)], [fake('two', 5)]])).toThrow(
      'Duplicate command number 5 ("one" and "two")',
    );
  });

  it('registers the info and assistant commands next to everyone else', () => {
    const numbers = allCommands.map((module) => module.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(allCommands.map((module) => module.id)).size).toBe(allCommands.length);
    for (const [number, id, group] of [
      [6, 'datetime', 'info'],
      [7, 'weather', 'info'],
      [8, 'battery', 'info'],
      [9, 'system-info', 'info'],
      [10, 'calculate', 'info'],
      [11, 'convert', 'info'],
      [12, 'define', 'info'],
      [26, 'circle-to-search', 'assistant'],
      [27, 'settings-and-help', 'assistant'],
      [28, 'stop', 'assistant'],
    ] as const) {
      expect(allCommands.find((module) => module.number === number)).toMatchObject({ id, group });
    }
  });
});

describe('ids and the public API', () => {
  it('creates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('exports what the app needs from one place', () => {
    expect(publicApi.createCommandEngine).toBe(createCommandEngine);
    expect(publicApi.runIntent).toBe(runIntent);
    expect(publicApi.webSearchFallback).toBe(webSearchFallback);
    expect(publicApi.allCommands).toBe(allCommands);
    expect(publicApi.newId).toBe(newId);
  });
});

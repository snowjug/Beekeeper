import { describe, expect, it } from 'vitest';
import type { StatusCard } from '@shared/cards';
import { dictateCommand } from '@main/commands/assistant/dictation';
import { createFakeServices, matchOf, runContext } from '../helpers';

describe('dictation: phrases', () => {
  it.each([
    'start dictation',
    'Start Dictation',
    'dictate',
    'dictation',
    'dictating',
    'type what I say',
    'type what i speak',
    "type what I'm saying",
    'type what i am saying',
    'type as I speak',
    'type with my voice',
    'type using voice',
    'type out what i say',
    'voice typing',
    'start voice typing',
    'voice typing mode',
    'dictation mode',
    'start dictation mode',
    'enter dictation mode',
    'turn on dictation',
    'begin dictating',
    'open dictation',
    'use voice dictation',
    'let me dictate',
    'i want to dictate',
    'can you start dictation please',
    'Hey Beekeeper, start dictation',
    'dictate?',
  ])('%s', (text) => {
    expect(matchOf(dictateCommand, text)).toEqual({ slots: {}, score: 0.97 });
  });

  it('repairs a typo with a lower score', () => {
    expect(matchOf(dictateCommand, 'start dictaton')).toEqual({ slots: {}, score: 0.85 });
    expect(matchOf(dictateCommand, 'dictat')).toEqual({ slots: {}, score: 0.85 });
    expect(matchOf(dictateCommand, 'voic typing')).toEqual({ slots: {}, score: 0.85 });
  });

  it.each([
    'what is dictation',
    'define dictation',
    'dictate a note to buy milk',
    'dictation software for windows',
    'type hello',
    'typing speed test',
    'take a note',
    'start timer',
    'open notepad',
    'start',
    'type',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(dictateCommand, text)).toBeNull();
  });

  it('outranks "open <app>" for "start dictation"', () => {
    expect(dictateCommand.priority).toBeGreaterThan(0);
  });

  it('matches every example it advertises', () => {
    expect(dictateCommand.examples.length).toBeGreaterThanOrEqual(5);
    for (const example of dictateCommand.examples) {
      expect(matchOf(dictateCommand, example), example).not.toBeNull();
    }
  });
});

describe('dictation: answers', () => {
  it('starts dictation and gets out of the way so the text goes into the app below', async () => {
    const services = createFakeServices();
    const result = await dictateCommand.run({}, runContext({ services }));

    expect(services.ui.startDictation).toHaveBeenCalledTimes(1);
    expect(result.closeNow).toBe(true);
    // The assistant must stay silent: the microphone is about to open.
    expect(result.speech).toBeUndefined();
    expect(result.cards[0] as StatusCard).toMatchObject({
      kind: 'status',
      icon: 'mic',
      title: 'Dictation',
    });
  });
});

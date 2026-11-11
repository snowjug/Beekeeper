import { describe, expect, it } from 'vitest';
import { stopCommand } from '@main/commands/assistant/stop';
import { createFakeServices, matchOf, runContext } from '../helpers';

describe('stop: phrases', () => {
  it.each([
    'stop',
    'Stop',
    'cancel',
    'never mind',
    'nevermind',
    'nvm',
    'forget it',
    'forget about it',
    'be quiet',
    'quiet',
    'stop talking',
    'stop listening',
    'stop speaking',
    'stop it',
    'stop that',
    'stop now',
    'cancel that',
    'cancel it',
    "that's all",
    'that will be all',
    "that's enough",
    'enough',
    'dismiss',
    'close',
    'close that',
    'hush',
    'Hey Beekeeper, stop please',
    'Okay, never mind!',
  ])('%s', (text) => {
    expect(matchOf(stopCommand, text)).toEqual({ slots: {}, score: 0.98 });
  });

  it.each([
    'stop the timer',
    'cancel my timer',
    'cancel the reminder',
    'close notepad',
    'close the window',
    'stop the music',
    'stop playing',
    'stop recording',
    'stopwatch',
    'cancel all timers',
    'dismiss the notification',
    "that's all folks",
    'never mind the weather',
    'what time is it',
    '',
  ])('does not take over %j', (text) => {
    expect(matchOf(stopCommand, text)).toBeNull();
  });

  it('outranks a bare "close" for the close-app command', () => {
    expect(stopCommand.priority).toBeGreaterThan(0);
  });

  it('matches every example it advertises', () => {
    expect(stopCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of stopCommand.examples) {
      expect(matchOf(stopCommand, example), example).not.toBeNull();
    }
  });
});

describe('stop: answers', () => {
  it('silences speech, cancels pending work and closes the bar without a word', async () => {
    const services = createFakeServices();
    const result = await stopCommand.run({}, runContext({ services }));
    expect(services.ui.stopSpeaking).toHaveBeenCalledTimes(1);
    expect(services.ui.cancelPending).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ cards: [], closeNow: true });
  });
});

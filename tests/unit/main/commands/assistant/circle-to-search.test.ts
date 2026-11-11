import { describe, expect, it } from 'vitest';
import type { StatusCard } from '@shared/cards';
import { circleToSearchCommand } from '@main/commands/assistant/circle-to-search';
import { createFakeServices, matchOf, runContext } from '../helpers';

describe('circle to search: phrases', () => {
  it.each([
    'circle to search',
    'Circle to Search',
    'circle this',
    'circle that',
    'circle something on my screen',
    'search my screen',
    'search the screen',
    'search this screen',
    'scan my screen',
    'start circle to search',
    'open circle to search',
    'launch circle to search',
    "what's on my screen",
    'what is on the screen',
    'Hey Beekeeper, circle to search please',
  ])('%s', (text) => {
    expect(matchOf(circleToSearchCommand, text)).toEqual({ slots: {}, score: 0.97 });
  });

  it('repairs a typo with a lower score', () => {
    expect(matchOf(circleToSearchCommand, 'cirlce to search')).toEqual({ slots: {}, score: 0.85 });
    expect(matchOf(circleToSearchCommand, 'serach my screen')).toEqual({ slots: {}, score: 0.85 });
  });

  it.each([
    'search for cats',
    'search my files',
    'search my screenshots',
    'circle',
    'circle of fifths',
    'what is on the table',
    'take a screenshot',
    'open settings',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(circleToSearchCommand, text)).toBeNull();
  });

  it('outranks the generic search commands', () => {
    expect(circleToSearchCommand.priority).toBeGreaterThan(0);
  });

  it('matches every example it advertises', () => {
    expect(circleToSearchCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of circleToSearchCommand.examples) {
      expect(matchOf(circleToSearchCommand, example), example).not.toBeNull();
    }
  });
});

describe('circle to search: answers', () => {
  it('opens the overlay and gets out of the way', async () => {
    const services = createFakeServices();
    const result = await circleToSearchCommand.run({}, runContext({ services }));
    expect(services.ui.openCircleToSearch).toHaveBeenCalledTimes(1);
    expect(result.closeNow).toBe(true);
    expect(result.speech).toBeUndefined();
    expect(result.cards[0] as StatusCard).toMatchObject({
      kind: 'status',
      icon: 'circle',
      title: 'Circle to Search',
    });
  });
});

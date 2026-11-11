import { describe, expect, it } from 'vitest';
import { productivityCommands } from '@main/commands/groups/productivity';
import { normalizeInput } from '@main/commands/text';
import { createHarness } from './fakes';

describe('productivity command group', () => {
  it('registers commands 13 to 17 in order, each with a unique id', () => {
    expect(productivityCommands.map((command) => [command.number, command.id])).toEqual([
      [13, 'timer'],
      [14, 'reminder'],
      [15, 'alarm'],
      [16, 'notes'],
      [17, 'copy-that'],
    ]);
    expect(productivityCommands.every((command) => command.group === 'productivity')).toBe(true);
    expect(productivityCommands.every((command) => command.title.length > 0)).toBe(true);
  });

  describe.each(productivityCommands.map((command) => [command.id, command] as const))(
    '%s examples',
    (_id, command) => {
      it('has at least three examples', () => {
        expect(command.examples.length).toBeGreaterThanOrEqual(3);
      });

      it.each(command.examples)('matches its own example %j best', (example) => {
        const h = createHarness();
        const input = normalizeInput(example);
        const scores = productivityCommands.map((candidate) => ({
          id: candidate.id,
          score: candidate.match(input, h.parseContext())?.score ?? 0,
        }));
        const own = scores.find((entry) => entry.id === command.id);
        expect(own?.score).toBeGreaterThan(0);
        const best = Math.max(...scores.map((entry) => entry.score));
        expect(own?.score).toBe(best);
        expect(scores.filter((entry) => entry.score === best)).toHaveLength(1);
      });
    },
  );

  it('never needs a service the contract keeps for other commands', () => {
    const h = createHarness();
    for (const command of productivityCommands) {
      for (const example of command.examples) {
        expect(() => command.match(normalizeInput(example), h.parseContext())).not.toThrow();
      }
    }
  });
});

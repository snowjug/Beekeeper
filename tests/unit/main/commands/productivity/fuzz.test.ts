import { describe, expect, it } from 'vitest';
import { productivityCommands } from '@main/commands/groups/productivity';
import { normalizeInput } from '@main/commands/text';
import {
  findClockTime,
  findDuration,
  parseClockTime,
  parseDuration,
} from '@main/commands/timeparse';
import { NOW, createHarness } from './fakes';

const VOCABULARY =
  `set a an the my timer timers alarm reminder remind me note notes take make add delete
remove cancel stop show list copy that this it for in at to of about called every day tomorrow today tonight
noon midnight half past quarter and wake up search find last all confirm 5 10 0 12 24 99 7:30 19:45 1.5 3pm
7am 5min 1h30m o'clock on five thirty twenty hundred am pm p m a.m. minutes minute seconds hours hour days
weeks morning evening night from now later oh seven nine one two clock — : , ? ! constructor __proto__
toString ünïcödé 😀`.split(/\s+/);

/** Small deterministic generator so a failure can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('arbitrary input', () => {
  it('never breaks a parser, a matcher or a command run', async () => {
    const next = random(20_261_110);
    for (let round = 0; round < 1_500; round += 1) {
      const length = 1 + Math.floor(next() * 10);
      const words = Array.from(
        { length },
        () => VOCABULARY[Math.floor(next() * VOCABULARY.length)] ?? '',
      );
      const text = words.join(' ');

      parseDuration(text);
      findDuration(words);
      const times = [
        parseClockTime(text, NOW),
        findClockTime(words, NOW, { ambiguousHours: 'morning' }),
      ];
      for (const time of times) {
        if (time !== null) expect(Number.isNaN(time.at.getTime()), text).toBe(false);
      }

      const harness = createHarness();
      const input = normalizeInput(text);
      for (const command of productivityCommands) {
        const match = command.match(input, harness.parseContext());
        if (match === null) continue;
        expect(match.score, text).toBeGreaterThan(0);
        expect(match.score, text).toBeLessThanOrEqual(1);
        expect(() => JSON.stringify(match.slots), text).not.toThrow();

        const result = await command.run(match.slots, harness.runContext());
        expect(result.cards.length, text).toBeGreaterThan(0);
        for (const card of result.cards) expect(typeof card.id, text).toBe('string');
      }
    }
  });
});

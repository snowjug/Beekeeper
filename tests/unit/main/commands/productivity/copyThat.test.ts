import { describe, expect, it } from 'vitest';
import type { StatusCard } from '@shared/cards';
import { copyThatCommand } from '@main/commands/productivity/copyThat';
import { createHarness, execute } from './fakes';

function statusOf(card: unknown): StatusCard {
  return card as StatusCard;
}

describe('copy that', () => {
  it('copies the last answer and confirms briefly', async () => {
    const h = createHarness();
    h.ui.lastAnswer = 'The answer is 42';
    const result = await execute(h, copyThatCommand, 'copy that');

    expect(h.ui.copied).toEqual(['The answer is 42']);
    expect(result.speech).toBe('Copied to clipboard');
    expect(result.autoCloseMs).toBe(1200);
    expect(result.pin).toBeUndefined();
    expect(statusOf(result.cards[0])).toMatchObject({
      kind: 'status',
      tone: 'success',
      icon: 'copy',
      title: 'Copied to clipboard',
      detail: 'The answer is 42',
    });
  });

  it('shows a one-line preview of a long multi-line answer but copies all of it', async () => {
    const h = createHarness();
    const answer = `First line\n\n${'word '.repeat(60)}`;
    h.ui.lastAnswer = answer;
    const result = await execute(h, copyThatCommand, 'copy the answer');

    expect(h.ui.copied).toEqual([answer]);
    const detail = statusOf(result.cards[0]).detail ?? '';
    expect(detail.startsWith('First line word word')).toBe(true);
    expect(detail.endsWith('…')).toBe(true);
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(100);
  });

  it.each([null, '', '   \n'])('says there is nothing to copy for %j', async (answer) => {
    const h = createHarness();
    h.ui.lastAnswer = answer;
    const result = await execute(h, copyThatCommand, 'copy last answer');

    expect(h.ui.copied).toEqual([]);
    expect(statusOf(result.cards[0])).toMatchObject({
      tone: 'neutral',
      title: 'Nothing to copy yet',
    });
    expect(result.speech).toBe('There is nothing to copy yet.');
    expect(result.autoCloseMs).toBe(2500);
  });

  it('reports a clipboard failure instead of throwing', async () => {
    const h = createHarness();
    h.ui.lastAnswer = 'text';
    h.ui.copyError = new Error('clipboard busy');
    const result = await execute(h, copyThatCommand, 'copy it');

    expect(statusOf(result.cards[0])).toMatchObject({
      tone: 'error',
      icon: 'error',
      title: "I couldn't copy that",
    });
    expect(result.speech).toBe("I couldn't copy that.");
  });
});

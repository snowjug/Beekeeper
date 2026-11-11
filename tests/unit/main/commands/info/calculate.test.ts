import { describe, expect, it } from 'vitest';
import type { CalculationCard, StatusCard } from '@shared/cards';
import { calculateCommand } from '@main/commands/info/calculate';
import { matchOf, runContext } from '../helpers';

const sourceOf = (text: string) => matchOf(calculateCommand, text)?.slots.source;

describe('calculate: phrases', () => {
  it.each([
    ['calculate 15% of 2400', '15% of 2400', 0.95],
    ["what's 15 percent of 2400", '15 percent of 2400', 0.95],
    ['calculate 2 + 2 * 3', '2 + 2 * 3', 0.95],
    ['5 times 7', '5 times 7', 0.9],
    ['12 divided by 4', '12 divided by 4', 0.9],
    ['what is 2 to the power of 10', '2 to the power of 10', 0.95],
    ['square root of 144', 'square root of 144', 0.9],
    ['sqrt(81)', 'sqrt(81)', 0.9],
    ['calculate (3+4)*5', '(3+4)*5', 0.95],
    ['100 minus 25 percent', '100 minus 25 percent', 0.9],
    ["what's 7 squared", '7 squared', 0.95],
    ['calculate 20 / 3', '20 / 3', 0.95],
    ['15*4', '15*4', 0.9],
    ['2^8', '2^8', 0.9],
    ['what is five plus five', 'five plus five', 0.95],
    ['calculate twenty five times four', 'twenty five times four', 0.95],
    ['twenty percent of 150', 'twenty percent of 150', 0.9],
    ['how much is 20% of 80', '20% of 80', 0.95],
    ['compute 3 * 4', '3 * 4', 0.95],
    ['evaluate 9 - 3', '9 - 3', 0.95],
    ['calc 9 / 3', '9 / 3', 0.95],
    ['solve 3 * 3', '3 * 3', 0.95],
    ['work out 4 * 4', '4 * 4', 0.95],
    ['figure out 6 * 7', '6 * 7', 0.95],
    ['what is the square root of 2', 'square root of 2', 0.95],
    ['what is 9 mod 4', '9 mod 4', 0.95],
    ['what does 5 plus 5 equal', '5 plus 5', 0.95],
    ['2 plus 2 equals', '2 plus 2', 0.9],
    ['2+2=', '2+2', 0.9],
    ['what is pi', 'pi', 0.95],
    ['what is half of 100', 'half of 100', 0.95],
    ['what is the result of 6 times 7', '6 times 7', 0.95],
    ['what is 100 + 10%', '100 + 10%', 0.95],
    ['10 % 3', '10 % 3', 0.9],
    ['5 x 7', '5 x 7', 0.9],
    ['2 ** 10', '2 ** 10', 0.9],
    ['sin(30 degrees)', 'sin(30 degrees)', 0.9],
    ['calculate 5', '5', 0.95],
    ['Hey Beekeeper, could you please calculate 6 * 7?', '6 * 7', 0.95],
  ])('%s', (text, source, score) => {
    expect(matchOf(calculateCommand, text)).toEqual({ slots: { source }, score });
  });

  it('claims calculations that fail so it can explain why', () => {
    expect(sourceOf('what is 5 divided by 0')).toBe('5 divided by 0');
    expect(sourceOf('calculate 1/0')).toBe('1/0');
    expect(sourceOf('sqrt of -4')).toBe('sqrt of -4');
  });

  it('explains a calculation that is broken, but only after an explicit verb', () => {
    expect(matchOf(calculateCommand, 'calculate 2 +')).toEqual({
      slots: { source: '2 +' },
      score: 0.7,
    });
    expect(matchOf(calculateCommand, 'compute (3 + 4')).toEqual({
      slots: { source: '(3 + 4' },
      score: 0.7,
    });
    expect(matchOf(calculateCommand, 'calculate')).toEqual({ slots: { source: '' }, score: 0.7 });
    expect(matchOf(calculateCommand, 'what is 2 +')).toBeNull();
    expect(matchOf(calculateCommand, '2 +')).toBeNull();
  });

  it('repairs a typo in the verb with a lower score', () => {
    expect(matchOf(calculateCommand, 'calcualte 5 + 5')).toEqual({
      slots: { source: '5 + 5' },
      score: 0.85,
    });
    expect(matchOf(calculateCommand, 'computte 5 + 5')).toMatchObject({ score: 0.85 });
  });

  it.each([
    'what is the weather',
    'what is love',
    'what is 5',
    'what is a',
    'what is x',
    "what's 5 km in miles",
    'what is 100 fahrenheit in celsius',
    'convert 5 km to miles',
    'set a timer for 5 minutes',
    'volume 50',
    'set volume to 50%',
    '10:30',
    '2024-11-10',
    '3-4 minutes',
    'calculate the tip',
    'calculate how many days until christmas',
    '5',
    'pi',
    '50%',
    '7 squared meters',
    'hello world',
    'weather in paris',
    'open notepad',
    '',
  ])('ignores %j', (text) => {
    expect(matchOf(calculateCommand, text)).toBeNull();
  });

  it('matches every example it advertises', () => {
    expect(calculateCommand.examples.length).toBeGreaterThanOrEqual(3);
    for (const example of calculateCommand.examples) {
      expect(matchOf(calculateCommand, example), example).not.toBeNull();
    }
  });
});

describe('calculate: answers', () => {
  const run = async (source: string) => {
    const result = await calculateCommand.run({ source }, runContext());
    return { result, card: result.cards[0] as CalculationCard };
  };

  it('answers 15% of 2400', async () => {
    const { result, card } = await run('15% of 2400');
    expect(card).toMatchObject({
      kind: 'calc',
      id: 'id-1',
      expression: '15% of 2400',
      resultText: '360',
      value: 360,
      copyText: '360',
    });
    expect(result.speech).toBe('15 percent of 2400 is 360.');
  });

  it.each([
    ['2 + 2 * 3', '2 + 2 × 3', '8', '2 plus 2 times 3 is 8.'],
    ['20 / 3', '20 ÷ 3', '6.666667', '20 divided by 3 is 6.666667.'],
    ['2^10', '2^10', '1,024', '2 to the power of 10 is 1,024.'],
    ['square root of 144', 'sqrt(144)', '12', 'the square root of 144 is 12.'],
    ['100 minus 25 percent', '100 − 25%', '75', '100 minus 25 percent is 75.'],
    ['7 squared', '7²', '49', '7 squared is 49.'],
    ['3 cubed', '3³', '27', '3 cubed is 27.'],
    ['-5 + 3', '−5 + 3', '-2', 'minus 5 plus 3 is -2.'],
    ['sin(30 degrees)', 'sin(30°)', '0.5', 'sine of 30 degrees is 0.5.'],
    ['pi', 'π', '3.141593', 'pi is 3.141593.'],
    ['ln(e)', 'ln(e)', '1', 'the natural log of e is 1.'],
    ['1,000 * 3', '1,000 × 3', '3,000', '1,000 times 3 is 3,000.'],
    ['0.1 + 0.2', '0.1 + 0.2', '0.3', '0.1 plus 0.2 is 0.3.'],
    ['sin(pi)', 'sin(π)', '1.224647e-16', 'sine of pi is 1.224647e-16.'],
  ])('%s', async (source, expression, resultText, speech) => {
    const { result, card } = await run(source);
    expect(card.expression).toBe(expression);
    expect(card.resultText).toBe(resultText);
    expect(result.speech).toBe(speech);
  });

  it('copies the plain number without thousands separators', async () => {
    expect((await run('2^20')).card.copyText).toBe('1048576');
  });

  it.each([
    ['5 / 0', "I can't divide by zero", "I can't divide by zero."],
    ['sqrt(-4)', "That doesn't have a real answer", "That doesn't have a real answer."],
    ['9^9^9', 'That number is too large', 'That number is too large for me to work out.'],
  ])('explains why %s has no answer', async (source, title, speech) => {
    const { result } = await run(source);
    const card = result.cards[0] as StatusCard;
    expect(card).toMatchObject({ kind: 'status', tone: 'warning', icon: 'calculator', title });
    expect(card.detail).toBeDefined();
    expect(result.speech).toBe(speech);
  });

  it('shows the failing expression', async () => {
    expect(((await run('5 / 0')).result.cards[0] as StatusCard).detail).toBe('5 ÷ 0');
  });

  it('refuses text that is not a calculation', async () => {
    const { result } = await run('hello');
    const card = result.cards[0] as StatusCard;
    expect(card).toMatchObject({
      kind: 'status',
      tone: 'warning',
      icon: 'calculator',
      title: "I couldn't understand that calculation",
      detail: 'Try something like "calculate 15% of 2400".',
    });
    expect(result.speech).toBe(
      "I couldn't understand that calculation. Try something like calculate 15 percent of 2400.",
    );
  });
});

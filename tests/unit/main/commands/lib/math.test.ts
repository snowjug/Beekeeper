import { describe, expect, it } from 'vitest';
import { evaluateMath } from '@main/commands/lib/math';

function value(source: string): number {
  const outcome = evaluateMath(source);
  if (outcome.status !== 'ok') throw new Error(`"${source}" did not evaluate: ${outcome.status}`);
  return outcome.value;
}

describe('evaluateMath: arithmetic', () => {
  it.each([
    ['2 + 2', 4],
    ['2 + 2 * 3', 8],
    ['(3+4)*5', 35],
    ['20 / 3', 6.66666666667],
    ['15*4', 60],
    ['10 - 4 - 3', 3],
    ['100 / 5 / 2', 10],
    ['2^10', 1024],
    ['2^3^2', 512],
    ['2 ** 5', 32],
    ['-2^2', -4],
    ['(-2)^2', 4],
    ['2^-1', 0.5],
    ['-5 + 3', -2],
    ['--5', 5],
    ['+5', 5],
    ['0.1 + 0.2', 0.3],
    ['1,000 * 3', 3000],
    ['.5 * 4', 2],
    ['10 % 3', 1],
    ['10 mod 4', 2],
    ['7 × 6', 42],
    ['9 ÷ 3', 3],
    ['9 − 3', 6],
    ['2(3+4)', 14],
    ['3 pi', 3 * Math.PI],
    ['2 * (1 + (2 + 3) * 2)', 22],
  ])('%s = %s', (source, expected) => {
    expect(value(source)).toBeCloseTo(expected, 10);
  });

  it('keeps unary minus below the power operator', () => {
    expect(value('-3^2')).toBe(-9);
    expect(value('2 * -3')).toBe(-6);
  });
});

describe('evaluateMath: percentages', () => {
  it.each([
    ['15% of 2400', 360],
    ['15 percent of 2400', 360],
    ['50% of 80', 40],
    ['25% of 200', 50],
    ['100 - 25%', 75],
    ['100 minus 25 percent', 75],
    ['100 + 10%', 110],
    ['200 * 10%', 20],
    ['50%', 0.5],
    ['1,000 + 5%', 1050],
    ['twenty percent of 150', 30],
  ])('%s = %s', (source, expected) => {
    expect(value(source)).toBeCloseTo(expected, 10);
  });
});

describe('evaluateMath: words', () => {
  it.each([
    ['five times seven', 35],
    ['5 times 7', 35],
    ['12 divided by 4', 3],
    ['12 over 4', 3],
    ['2 plus 2', 4],
    ['10 minus 3', 7],
    ['6 multiplied by 7', 42],
    ['2 to the power of 10', 1024],
    ['2 raised to the power of 3', 8],
    ['2 raised to 3', 8],
    ['7 squared', 49],
    ['3 cubed', 27],
    ['square root of 144', 12],
    ['square root of 2', Math.SQRT2],
    ['cube root of 27', 3],
    ['sqrt 16', 4],
    ['sqrt(81)', 9],
    ['√144', 12],
    ['absolute value of -5', 5],
    ['abs(-7)', 7],
    ['round(2.6)', 3],
    ['floor(2.9)', 2],
    ['ceil(2.1)', 3],
    ['ceiling(2.1)', 3],
    ['log(1000)', 3],
    ['ln(e)', 1],
    ['natural log of 1', 0],
    ['sin(0)', 0],
    ['cos(0)', 1],
    ['tan(0)', 0],
    ['sine of 0', 0],
    ['sin(30 degrees)', 0.5],
    ['sin 30 °', 0.5],
    ['pi', Math.PI],
    ['π * 2', 2 * Math.PI],
    ['e', Math.E],
    ['half of 100', 50],
    ['quarter of 80', 20],
    ['one hundred and five plus one', 106],
    ['two thousand three hundred minus 300', 2000],
    ['a hundred times 3', 300],
    ['9 mod 4', 1],
    ['10 modulo 3', 1],
    ['(3 + 4) squared', 49],
    ['sqrt(16) squared', 16],
  ])('%s = %s', (source, expected) => {
    expect(value(source)).toBeCloseTo(expected, 10);
  });
});

describe('evaluateMath: display and classification', () => {
  it('renders a tidy expression', () => {
    expect(evaluateMath('15% of 2400')).toMatchObject({ expression: '15% of 2400' });
    expect(evaluateMath('2 * 3')).toMatchObject({ expression: '2 × 3' });
    expect(evaluateMath('9/3')).toMatchObject({ expression: '9 ÷ 3' });
    expect(evaluateMath('5 - 2')).toMatchObject({ expression: '5 − 2' });
    expect(evaluateMath('-4 + 1')).toMatchObject({ expression: '−4 + 1' });
    expect(evaluateMath('2^8')).toMatchObject({ expression: '2^8' });
    expect(evaluateMath('7 squared')).toMatchObject({ expression: '7²' });
    expect(evaluateMath('3 cubed')).toMatchObject({ expression: '3³' });
    expect(evaluateMath('sin(30 degrees)')).toMatchObject({ expression: 'sin(30°)' });
    expect(evaluateMath('square root of 144')).toMatchObject({ expression: 'sqrt(144)' });
    expect(evaluateMath('sqrt 16')).toMatchObject({ expression: 'sqrt(16)' });
    expect(evaluateMath('five plus five')).toMatchObject({ expression: '5 + 5' });
    expect(evaluateMath('(1+2)*3')).toMatchObject({ expression: '(1 + 2) × 3' });
    expect(evaluateMath('10 mod 4')).toMatchObject({ expression: '10 mod 4' });
  });

  it('classifies what kind of input it was', () => {
    expect(evaluateMath('5')).toMatchObject({ kind: 'literal' });
    expect(evaluateMath('-5')).toMatchObject({ kind: 'literal' });
    expect(evaluateMath('(5)')).toMatchObject({ kind: 'literal' });
    expect(evaluateMath('50%')).toMatchObject({ kind: 'modifier' });
    expect(evaluateMath('pi')).toMatchObject({ kind: 'modifier' });
    expect(evaluateMath('45 degrees')).toMatchObject({ kind: 'modifier' });
    expect(evaluateMath('1+1')).toMatchObject({ kind: 'operation' });
    expect(evaluateMath('7 squared')).toMatchObject({ kind: 'operation' });
    expect(evaluateMath('sqrt(4)')).toMatchObject({ kind: 'operation' });
  });
});

describe('evaluateMath: errors', () => {
  it.each([
    ['5 / 0', 'division-by-zero'],
    ['5 divided by 0', 'division-by-zero'],
    ['5 mod 0', 'division-by-zero'],
    ['0^-1', 'division-by-zero'],
    ['sqrt(-4)', 'domain'],
    ['log(0)', 'domain'],
    ['ln(-1)', 'domain'],
    ['(-8)^0.5', 'domain'],
    ['9^9^9', 'overflow'],
    ['99999999999 ^ 99999', 'overflow'],
  ])('%s fails with %s', (source, reason) => {
    expect(evaluateMath(source)).toMatchObject({ status: 'failed', reason });
  });

  it('keeps the expression of a failed evaluation', () => {
    expect(evaluateMath('5 / 0')).toMatchObject({ expression: '5 ÷ 0', kind: 'operation' });
  });

  it.each(['', '   ', '+', '2 +', '* 3', '(2 + 3', '2 + 3)', '2 3', '1.2.3', 'x', 'sqrt', '5 of'])(
    'calls %j broken maths',
    (source) => {
      expect(evaluateMath(source)).toEqual({ status: 'syntax-error', unrecognized: false });
    },
  );

  it.each([
    '5 km',
    'the weather',
    'hello world',
    '2 + two words',
    '1,5 + 2',
    '2 $ 3',
    '.',
    'a',
    `${'(1+'.repeat(100)}1${')'.repeat(100)}`,
  ])('calls %j not maths at all', (source) => {
    expect(evaluateMath(source)).toEqual({ status: 'syntax-error', unrecognized: true });
  });

  it('never evaluates code', () => {
    for (const source of [
      'process.exit(1)',
      'constructor',
      '2; alert(1)',
      'toString',
      '__proto__',
    ]) {
      expect(evaluateMath(source), source).toEqual({ status: 'syntax-error', unrecognized: true });
    }
  });
});

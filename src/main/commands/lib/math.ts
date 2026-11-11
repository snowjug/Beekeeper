/**
 * Safe arithmetic: a tokenizer feeding a recursive-descent parser (precedence climbing) that
 * builds a small syntax tree. Nothing is ever evaluated as code.
 *
 * Supports + - * / ^ %, unary minus, parentheses, word operators ("plus", "divided by",
 * "to the power of", "squared", "percent of", "mod"), number words, the constants pi and e and
 * the functions sqrt, cbrt, abs, round, floor, ceil, sin, cos, tan, log (base 10) and ln.
 */
import { findNumberSafe } from './numbers';

/** literal = a plain number, modifier = "50%" or "pi", operation = anything that computes. */
type MathKind = 'literal' | 'modifier' | 'operation';
export type MathFailure = 'division-by-zero' | 'domain' | 'overflow';

/**
 * `unrecognized` tells "this is not maths" (unknown words or symbols) from "this is maths but
 * broken" (a dangling operator, a missing bracket).
 */
type MathOutcome =
  | { status: 'syntax-error'; unrecognized: boolean }
  | { status: 'failed'; reason: MathFailure; expression: string; kind: MathKind }
  | { status: 'ok'; value: number; expression: string; kind: MathKind };

type BinaryOp = '+' | '-' | '*' | '/' | '^' | 'mod';
type PostfixOp = 'percent' | 'squared' | 'cubed' | 'degrees';
type FunctionName =
  'sqrt' | 'cbrt' | 'abs' | 'round' | 'floor' | 'ceil' | 'sin' | 'cos' | 'tan' | 'log' | 'ln';

type Token =
  | { type: 'num'; value: number; text: string }
  | { type: 'const'; value: number; text: string }
  | { type: 'binary'; op: BinaryOp; symbol: string }
  | { type: 'postfix'; op: PostfixOp }
  | { type: 'func'; name: FunctionName }
  | { type: 'open' }
  | { type: 'close' };

interface PercentSign {
  type: 'percent-sign';
}

type RawToken = Token | PercentSign | { type: 'word'; text: string };

type Node =
  | { kind: 'num'; value: number; text: string }
  | { kind: 'const'; value: number; text: string }
  | { kind: 'neg'; operand: Node }
  | { kind: 'binary'; op: BinaryOp; symbol: string; left: Node; right: Node }
  | { kind: 'postfix'; op: PostfixOp; operand: Node }
  | { kind: 'call'; name: FunctionName; arg: Node }
  | { kind: 'group'; inner: Node };

const MAX_LENGTH = 200;
const NUMBER_AT = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+/y;
const WORD_AT = /[a-z]+/y;
const TIMES_SYMBOL = '×';

class MathSyntaxError extends Error {}

class MathEvalError extends Error {
  constructor(readonly reason: MathFailure) {
    super(reason);
  }
}

const binary = (op: BinaryOp, symbol: string): Token => ({ type: 'binary', op, symbol });
const postfix = (op: PostfixOp): Token => ({ type: 'postfix', op });
const func = (name: FunctionName): Token => ({ type: 'func', name });

const PLUS = binary('+', '+');
const MINUS = binary('-', '−');
const TIMES = binary('*', TIMES_SYMBOL);
const DIVIDE = binary('/', '÷');
const POWER = binary('^', '^');
const MODULO = binary('mod', 'mod');
const PI: Token = { type: 'const', value: Math.PI, text: 'π' };

interface Phrase {
  words: readonly string[];
  token: Token;
}

const PHRASE_TABLE: Phrase[] = [
  { words: ['plus'], token: PLUS },
  { words: ['minus'], token: MINUS },
  { words: ['times'], token: TIMES },
  { words: ['x'], token: TIMES },
  { words: ['multiplied', 'by'], token: TIMES },
  { words: ['multiply', 'by'], token: TIMES },
  { words: ['divided', 'by'], token: DIVIDE },
  { words: ['divide', 'by'], token: DIVIDE },
  { words: ['over'], token: DIVIDE },
  { words: ['to', 'the', 'power', 'of'], token: POWER },
  { words: ['to', 'the', 'power'], token: POWER },
  { words: ['raised', 'to', 'the', 'power', 'of'], token: POWER },
  { words: ['raised', 'to', 'the', 'power'], token: POWER },
  { words: ['raised', 'to'], token: POWER },
  { words: ['mod'], token: MODULO },
  { words: ['modulo'], token: MODULO },
  { words: ['squared'], token: postfix('squared') },
  { words: ['cubed'], token: postfix('cubed') },
  { words: ['percent'], token: postfix('percent') },
  { words: ['per', 'cent'], token: postfix('percent') },
  { words: ['degrees'], token: postfix('degrees') },
  { words: ['degree'], token: postfix('degrees') },
  { words: ['square', 'root'], token: func('sqrt') },
  { words: ['sqrt'], token: func('sqrt') },
  { words: ['cube', 'root'], token: func('cbrt') },
  { words: ['cbrt'], token: func('cbrt') },
  { words: ['absolute', 'value'], token: func('abs') },
  { words: ['abs'], token: func('abs') },
  { words: ['round'], token: func('round') },
  { words: ['floor'], token: func('floor') },
  { words: ['ceil'], token: func('ceil') },
  { words: ['ceiling'], token: func('ceil') },
  { words: ['sin'], token: func('sin') },
  { words: ['sine'], token: func('sin') },
  { words: ['cos'], token: func('cos') },
  { words: ['cosine'], token: func('cos') },
  { words: ['tan'], token: func('tan') },
  { words: ['tangent'], token: func('tan') },
  { words: ['log'], token: func('log') },
  { words: ['logarithm'], token: func('log') },
  { words: ['ln'], token: func('ln') },
  { words: ['natural', 'log'], token: func('ln') },
  { words: ['natural', 'logarithm'], token: func('ln') },
  { words: ['pi'], token: PI },
  { words: ['half'], token: { type: 'num', value: 0.5, text: 'half' } },
  { words: ['quarter'], token: { type: 'num', value: 0.25, text: 'quarter' } },
  { words: ['e'], token: { type: 'const', value: Math.E, text: 'e' } },
];

/** Longest phrase first so "to the power of" wins over "to". */
const PHRASES = [...PHRASE_TABLE].sort((a, b) => b.words.length - a.words.length);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function lex(source: string): RawToken[] | null {
  const raw: RawToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === ' ') {
      index += 1;
    } else if (/[\d.]/.test(char)) {
      NUMBER_AT.lastIndex = index;
      const match = NUMBER_AT.exec(source);
      if (!match) return null;
      raw.push({ type: 'num', value: Number(match[0].replace(/,/g, '')), text: match[0] });
      index += match[0].length;
    } else if (/[a-z]/.test(char)) {
      WORD_AT.lastIndex = index;
      const text = WORD_AT.exec(source)?.[0] ?? char;
      raw.push({ type: 'word', text });
      index += text.length;
    } else {
      index += 1;
      switch (char) {
        case '+':
          raw.push(PLUS);
          break;
        case '-':
        case '−':
          raw.push(MINUS);
          break;
        case '*':
          if (source[index] === '*') {
            index += 1;
            raw.push(POWER);
          } else {
            raw.push(TIMES);
          }
          break;
        case '×':
        case '·':
          raw.push(TIMES);
          break;
        case '/':
        case '÷':
          raw.push(DIVIDE);
          break;
        case '^':
          raw.push(POWER);
          break;
        case '%':
          raw.push({ type: 'percent-sign' });
          break;
        case '(':
        case '[':
          raw.push({ type: 'open' });
          break;
        case ')':
        case ']':
          raw.push({ type: 'close' });
          break;
        case '°':
          raw.push(postfix('degrees'));
          break;
        case '√':
          raw.push(func('sqrt'));
          break;
        case 'π':
          raw.push(PI);
          break;
        default:
          return null;
      }
    }
  }
  return raw;
}

/** Turns words ("divided by", "five", "square root") into tokens; null on unknown words. */
function resolveWords(raw: readonly RawToken[]): Array<Token | PercentSign> | null {
  const resolved: Array<Token | PercentSign> = [];
  let index = 0;
  while (index < raw.length) {
    const item = raw[index];
    if (item === undefined) break;
    if (item.type !== 'word') {
      resolved.push(item);
      index += 1;
      continue;
    }

    const run: string[] = [];
    for (let k = index; k < raw.length; k += 1) {
      const candidate = raw[k];
      if (candidate?.type !== 'word') break;
      run.push(candidate.text);
    }

    if (run[0] === 'of') {
      // "15% of 2400" multiplies; "square root of 144" just reads naturally.
      if (resolved[resolved.length - 1]?.type !== 'func') {
        resolved.push({ type: 'binary', op: '*', symbol: 'of' });
      }
      index += 1;
      continue;
    }
    const number = findNumberSafe(run, 0);
    if (number !== null && number.start === 0) {
      resolved.push({ type: 'num', value: number.value, text: String(number.value) });
      index += number.end;
      continue;
    }
    const phrase = PHRASES.find((candidate) =>
      candidate.words.every((word, offset) => run[offset] === word),
    );
    if (phrase === undefined) return null;
    resolved.push(phrase.token);
    index += phrase.words.length;
  }
  return resolved;
}

/** "%" before an operand is modulo ("10 % 3"); anywhere else it is a percentage ("15%"). */
function resolvePercentSigns(items: ReadonlyArray<Token | PercentSign>): Token[] {
  return items.map((item, index) => {
    if (item.type !== 'percent-sign') return item;
    const next = items[index + 1];
    const operandFollows =
      next !== undefined &&
      (next.type === 'num' ||
        next.type === 'open' ||
        next.type === 'const' ||
        next.type === 'func');
    return operandFollows ? MODULO : postfix('percent');
  });
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Node {
    const tree = this.expression();
    if (this.index < this.tokens.length) throw new MathSyntaxError();
    return tree;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private expression(): Node {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.type !== 'binary' || (token.op !== '+' && token.op !== '-')) return left;
      this.index += 1;
      left = { kind: 'binary', op: token.op, symbol: token.symbol, left, right: this.term() };
    }
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (
        token?.type === 'binary' &&
        (token.op === '*' || token.op === '/' || token.op === 'mod')
      ) {
        this.index += 1;
        left = { kind: 'binary', op: token.op, symbol: token.symbol, left, right: this.unary() };
      } else if (token?.type === 'open' || token?.type === 'const' || token?.type === 'func') {
        // Implicit multiplication: "2(3+4)", "2pi".
        left = { kind: 'binary', op: '*', symbol: TIMES_SYMBOL, left, right: this.unary() };
      } else {
        return left;
      }
    }
  }

  private unary(): Node {
    const token = this.peek();
    if (token?.type === 'binary' && (token.op === '-' || token.op === '+')) {
      this.index += 1;
      const operand = this.unary();
      return token.op === '-' ? { kind: 'neg', operand } : operand;
    }
    return this.power();
  }

  private power(): Node {
    const base = this.postfix();
    const token = this.peek();
    if (token?.type === 'binary' && token.op === '^') {
      this.index += 1;
      return { kind: 'binary', op: '^', symbol: '^', left: base, right: this.unary() };
    }
    return base;
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      const token = this.peek();
      if (token?.type !== 'postfix') return node;
      this.index += 1;
      node = { kind: 'postfix', op: token.op, operand: node };
    }
  }

  private primary(): Node {
    const token = this.peek();
    this.index += 1;
    switch (token?.type) {
      case 'num':
      case 'const':
        return { kind: token.type, value: token.value, text: token.text };
      case 'open': {
        const inner = this.expression();
        if (this.peek()?.type !== 'close') throw new MathSyntaxError();
        this.index += 1;
        return { kind: 'group', inner };
      }
      case 'func':
        return {
          kind: 'call',
          name: token.name,
          arg: this.peek()?.type === 'open' ? this.primary() : this.unary(),
        };
      default:
        throw new MathSyntaxError();
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation and display
// ---------------------------------------------------------------------------

function isPercent(node: Node): boolean {
  return node.kind === 'postfix' && node.op === 'percent';
}

function applyFunction(name: FunctionName, value: number): number {
  switch (name) {
    case 'sqrt':
      if (value < 0) throw new MathEvalError('domain');
      return Math.sqrt(value);
    case 'cbrt':
      return Math.cbrt(value);
    case 'abs':
      return Math.abs(value);
    case 'round':
      return Math.round(value);
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'sin':
      return Math.sin(value);
    case 'cos':
      return Math.cos(value);
    case 'tan':
      return Math.tan(value);
    case 'log':
      if (value <= 0) throw new MathEvalError('domain');
      return Math.log10(value);
    case 'ln':
      if (value <= 0) throw new MathEvalError('domain');
      return Math.log(value);
  }
}

function applyBinary(op: BinaryOp, left: number, right: number): number {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
    case 'mod':
      if (right === 0) throw new MathEvalError('division-by-zero');
      return op === '/' ? left / right : left % right;
    case '^': {
      if (left === 0 && right < 0) throw new MathEvalError('division-by-zero');
      const result = Math.pow(left, right);
      if (Number.isNaN(result)) throw new MathEvalError('domain');
      return result;
    }
  }
}

function evaluate(node: Node): number {
  let value: number;
  switch (node.kind) {
    case 'num':
    case 'const':
      return node.value;
    case 'group':
      return evaluate(node.inner);
    case 'neg':
      return -evaluate(node.operand);
    case 'postfix': {
      const operand = evaluate(node.operand);
      if (node.op === 'percent') value = operand / 100;
      else if (node.op === 'squared') value = operand * operand;
      else if (node.op === 'cubed') value = operand * operand * operand;
      else value = (operand * Math.PI) / 180;
      break;
    }
    case 'call':
      value = applyFunction(node.name, evaluate(node.arg));
      break;
    case 'binary': {
      const left = evaluate(node.left);
      // "100 + 10%" and "100 - 25%" mean a percentage of the left operand.
      const right =
        (node.op === '+' || node.op === '-') && isPercent(node.right)
          ? left * evaluate(node.right)
          : evaluate(node.right);
      value = applyBinary(node.op, left, right);
      break;
    }
  }
  if (!Number.isFinite(value)) throw new MathEvalError('overflow');
  return value;
}

function render(node: Node): string {
  switch (node.kind) {
    case 'num':
    case 'const':
      return node.text;
    case 'group':
      return `(${render(node.inner)})`;
    case 'neg':
      return `−${render(node.operand)}`;
    case 'postfix': {
      const suffix = { percent: '%', squared: '²', cubed: '³', degrees: '°' }[node.op];
      return `${render(node.operand)}${suffix}`;
    }
    case 'call':
      return node.arg.kind === 'group'
        ? `${node.name}${render(node.arg)}`
        : `${node.name}(${render(node.arg)})`;
    case 'binary':
      if (node.op === '^') return `${render(node.left)}^${render(node.right)}`;
      return `${render(node.left)} ${node.symbol} ${render(node.right)}`;
  }
}

function classify(node: Node): MathKind {
  switch (node.kind) {
    case 'num':
      return 'literal';
    case 'group':
      return classify(node.inner);
    case 'neg':
      return classify(node.operand);
    case 'const':
      return 'modifier';
    case 'postfix':
      return node.op === 'squared' || node.op === 'cubed' ? 'operation' : 'modifier';
    case 'call':
    case 'binary':
      return 'operation';
  }
}

/** Parses and evaluates `source` (already lower-cased). Never throws. */
export function evaluateMath(source: string): MathOutcome {
  const text = source.trim();
  if (text.length === 0) return { status: 'syntax-error', unrecognized: false };
  if (text.length > MAX_LENGTH) return { status: 'syntax-error', unrecognized: true };

  const raw = lex(text);
  const words = raw === null ? null : resolveWords(raw);
  if (words === null) return { status: 'syntax-error', unrecognized: true };

  let tree: Node;
  try {
    tree = new Parser(resolvePercentSigns(words)).parse();
  } catch (error) {
    if (error instanceof MathSyntaxError) return { status: 'syntax-error', unrecognized: false };
    throw error;
  }

  const expression = render(tree);
  const kind = classify(tree);
  try {
    return { status: 'ok', value: Number(evaluate(tree).toPrecision(12)), expression, kind };
  } catch (error) {
    if (error instanceof MathEvalError) {
      return { status: 'failed', reason: error.reason, expression, kind };
    }
    throw error;
  }
}

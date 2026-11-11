/** A tokenised utterance with the helpers the command rules use. */
import { tokensOf, type Tok } from './pipeline';
import { romanize } from './romanize';

/** Words every rule ignores: fillers, light verbs, the verb "to be", polite pronouns and articles. */
export const NOISE: ReadonlySet<string> = new Set([
  'FILLER',
  'DO',
  'GIVE',
  'BE',
  'HOTA',
  'YOU',
  'CAN',
  'WANT',
  'ONE',
  'TURN',
  'LIKE',
]);

export class Utterance {
  readonly toks: readonly Tok[];

  constructor(toks: readonly Tok[]) {
    this.toks = toks;
  }

  static from(text: string): Utterance {
    return new Utterance(tokensOf(text));
  }

  /** True when at least one token has one of `syms`. */
  has(...syms: readonly string[]): boolean {
    return this.toks.some((token) => syms.includes(token.sym));
  }

  count(sym: string): number {
    return this.toks.filter((token) => token.sym === sym).length;
  }

  indexOf(sym: string, from = 0): number {
    for (let index = from; index < this.toks.length; index += 1) {
      if (this.toks[index]?.sym === sym) return index;
    }
    return -1;
  }

  find(sym: string): Tok | undefined {
    return this.toks.find((token) => token.sym === sym);
  }

  /** The tokens that carry meaning: everything but the symbols in `ignore`. */
  content(ignore: ReadonlySet<string> = NOISE): Tok[] {
    return this.toks.filter((token) => !ignore.has(token.sym));
  }
}

/** A readable Latin spelling of a Devanagari name ("रोहतक" -> "rohtak"); Latin words stay as they are. */
export function latinName(text: string): string {
  return romanize(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

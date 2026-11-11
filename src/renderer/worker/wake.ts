/** The phrase the wake word listens for, plus the spelling the recognizer may produce. */
export const WAKE_PHRASES = ['hey beekeeper', 'hey bee keeper'] as const;

/** Vosk grammar: the wake phrase or "anything else" ([unk]); this keeps recognition tiny and cheap. */
export const WAKE_GRAMMAR = JSON.stringify([...WAKE_PHRASES, '[unk]']);

/** True when recognised text contains the wake phrase ("hey, bee keeper" counts too). */
export function containsWakePhrase(text: string): boolean {
  const squashed = text.toLowerCase().replace(/[^a-z]/g, '');
  return squashed.includes('heybeekeeper');
}

export interface GateOptions {
  /** Keep feeding the recognizer this long after speech stopped so it can finish the phrase. */
  hangoverMs: number;
  /** Audio from just before speech started that is replayed into the recognizer. */
  preRollMs: number;
  minThreshold: number;
  /** Speech must exceed the noise floor by this factor. */
  margin: number;
}

export const DEFAULT_GATE: GateOptions = {
  hangoverMs: 1000,
  preRollMs: 500,
  minThreshold: 0.012,
  margin: 3.2,
};

export type Chunk = readonly [Float32Array, number];

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * Energy gate in front of the recognizer: audio is only forwarded while someone is (or just was)
 * speaking, so the wake word costs next to no CPU in a quiet room (spec 4.3: < 3 % idle).
 */
export class SpeechGate {
  private floor = 0.004;
  private open = false;
  private hangMs = 0;
  private preRoll: Chunk[] = [];
  private preRollMs = 0;

  constructor(private readonly options: GateOptions = DEFAULT_GATE) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Chunks to feed to the recognizer for this input chunk (empty while it is quiet). */
  push(samples: Float32Array, sampleRate: number): Chunk[] {
    const chunkMs = (samples.length / sampleRate) * 1000;
    const level = rmsOf(samples);
    this.floor = level < this.floor ? level : this.floor + (level - this.floor) * 0.002;
    const threshold = Math.max(this.options.minThreshold, this.floor * this.options.margin);
    const chunk: Chunk = [samples, sampleRate];

    if (level > threshold) {
      const out = this.open ? [chunk] : [...this.preRoll, chunk];
      this.preRoll = [];
      this.preRollMs = 0;
      this.open = true;
      this.hangMs = this.options.hangoverMs;
      return out;
    }

    if (this.open) {
      this.hangMs -= chunkMs;
      if (this.hangMs <= 0) this.open = false;
      return [chunk];
    }

    this.preRoll.push(chunk);
    this.preRollMs += chunkMs;
    while (this.preRollMs > this.options.preRollMs && this.preRoll.length > 1) {
      const dropped = this.preRoll.shift();
      if (dropped) this.preRollMs -= (dropped[0].length / dropped[1]) * 1000;
    }
    return [];
  }

  reset(): void {
    this.open = false;
    this.hangMs = 0;
    this.preRoll = [];
    this.preRollMs = 0;
  }
}

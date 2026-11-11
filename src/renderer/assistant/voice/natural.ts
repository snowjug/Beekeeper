import type { Bridge } from '@shared/ipc/bridge';
import type { SynthesizeResult } from '@shared/ipc/types';
import { speechChunks, type LangRun } from '@shared/speech/text';
import { SpeechPlayer } from '@renderer/lib/voice/player';

export interface NaturalSpeakOptions {
  onStart: () => void;
  onBoundary: () => void;
  onEnd: () => void;
}

/** How many sentences are synthesised ahead of the one that is playing. */
const LOOKAHEAD = 2;

type SpeechBridge = Pick<Bridge<'assistant'>, 'invoke'>;

/**
 * Speaks a reply with the on-device natural voice (or ElevenLabs). The reply is cut into sentences
 * (and language runs, so Hindi and English parts use the right voice model); the first sentence
 * starts playing as soon as it is ready while the next ones are still being rendered, which keeps
 * the delay before the first word short even for long answers.
 */
export class NaturalSpeaker {
  private readonly player = new SpeechPlayer();
  private generation = 0;
  private onEnd: (() => void) | null = null;

  get speaking(): boolean {
    return this.onEnd !== null;
  }

  constructor(private readonly bridge: SpeechBridge) {}

  /**
   * Resolves when the whole reply has been spoken (or was cancelled). Rejects only when the very
   * first sentence could not be synthesised, so the caller can fall back to another voice.
   */
  async speak(text: string, options: NaturalSpeakOptions): Promise<void> {
    this.cancel();
    const chunks = speechChunks(text);
    if (chunks.length === 0) return;

    const generation = ++this.generation;
    this.onEnd = options.onEnd;
    const pending: Array<Promise<SynthesizeResult> | undefined> = [];
    const request = (index: number): Promise<SynthesizeResult> | undefined => {
      const chunk: LangRun | undefined = chunks[index];
      if (!chunk) return undefined;
      pending[index] ??= this.bridge.invoke('speech:synthesize', {
        text: chunk.text,
        lang: chunk.lang,
      });
      return pending[index];
    };
    for (let index = 0; index < Math.min(LOOKAHEAD, chunks.length); index += 1) {
      const started = request(index);
      // A failure is reported through the awaited result below; never leave it unhandled.
      started?.catch(() => undefined);
    }

    const playing: Array<Promise<void>> = [];
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const result = await request(index);
        if (!result) break;
        if (generation !== this.generation) return;
        const next = request(index + LOOKAHEAD);
        next?.catch(() => undefined);
        if (index === 0) options.onStart();
        else options.onBoundary();
        playing.push(this.player.enqueue(result));
      }
    } catch (error) {
      if (generation !== this.generation) return;
      if (playing.length === 0) {
        this.finishIfCurrent(generation);
        throw error;
      }
      // A later sentence failed: finish what already plays, skip the rest.
    }

    await Promise.all(playing).catch(() => undefined);
    this.finishIfCurrent(generation);
  }

  /** Stops speaking at once; the end callback still fires once. */
  cancel(): void {
    const end = this.onEnd;
    this.generation += 1;
    this.onEnd = null;
    this.player.stop();
    end?.();
  }

  async dispose(): Promise<void> {
    this.cancel();
    await this.player.dispose();
  }

  private finishIfCurrent(generation: number): void {
    if (generation !== this.generation) return;
    const end = this.onEnd;
    this.onEnd = null;
    end?.();
  }
}

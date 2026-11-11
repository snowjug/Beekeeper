import type { KaldiRecognizer, Model } from 'vosk-browser';

/** The model (~150 MB in memory) is dropped after this much idle time to keep RAM low. */
export const MODEL_IDLE_RELEASE_MS = 10 * 60 * 1000;

/**
 * Lazily loads the Vosk model from the app protocol and keeps one instance alive. vosk-browser is
 * a large WASM bundle, so it is only imported the first time speech recognition is needed.
 */
export class ModelHost {
  private model: Model | null = null;
  private pending: Promise<Model> | null = null;
  private loadedUrl: string | null = null;
  private releaseTimer: number | null = null;

  get isLoaded(): boolean {
    return this.model !== null;
  }

  async load(url: string): Promise<Model> {
    this.cancelRelease();
    if (this.loadedUrl === url) {
      if (this.model) return this.model;
      if (this.pending) return this.pending;
    }
    this.release();
    this.loadedUrl = url;
    const promise = import('vosk-browser').then(({ createModel }) => createModel(url, -1));
    this.pending = promise;
    try {
      const model = await promise;
      if (this.pending === promise) this.model = model;
      else model.terminate();
      return model;
    } catch (error) {
      if (this.pending === promise) {
        this.pending = null;
        this.loadedUrl = null;
      }
      throw error;
    }
  }

  /** Frees the model after `delayMs` of inactivity (cancelled by the next `load`). */
  scheduleRelease(delayMs: number = MODEL_IDLE_RELEASE_MS): void {
    this.cancelRelease();
    this.releaseTimer = window.setTimeout(() => this.release(), delayMs);
  }

  cancelRelease(): void {
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  release(): void {
    this.cancelRelease();
    this.model?.terminate();
    this.model = null;
    this.pending = null;
    this.loadedUrl = null;
  }
}

export interface RecognitionHandlers {
  /** Everything recognised so far in this session (finished chunks + live partial words). */
  onText(text: string): void;
  onError(message: string): void;
}

const MAX_QUEUED_SECONDS = 30;

/**
 * One utterance worth of recognition. Audio fed before the model finished loading is queued and
 * replayed (recognition is faster than real time), so nothing the user said is lost.
 */
export class RecognitionSession {
  private recognizer: KaldiRecognizer | null = null;
  private readonly finished: string[] = [];
  private partial = '';
  private queue: Array<[Float32Array, number]> = [];
  private queuedSeconds = 0;
  private readonly ready: Promise<void>;
  private waiter: (() => void) | null = null;
  private closed = false;

  constructor(
    host: ModelHost,
    modelUrl: string,
    private readonly handlers: RecognitionHandlers,
    grammar?: string,
    sampleRate = 16_000,
  ) {
    this.ready = host
      .load(modelUrl)
      .then((model) => {
        if (this.closed) return;
        const recognizer = new model.KaldiRecognizer(sampleRate, grammar);
        recognizer.on('result', (message) => {
          if (message.event !== 'result') return;
          const text = message.result.text.trim();
          if (text) this.finished.push(text);
          this.partial = '';
          this.emit();
          this.waiter?.();
        });
        recognizer.on('partialresult', (message) => {
          if (message.event !== 'partialresult') return;
          this.partial = message.result.partial.trim();
          this.emit();
        });
        recognizer.on('error', (message) => {
          if (message.event === 'error') this.handlers.onError(message.error);
        });
        this.recognizer = recognizer;
        for (const [samples, rate] of this.queue) recognizer.acceptWaveformFloat(samples, rate);
        this.queue = [];
      })
      .catch((error: unknown) => {
        this.handlers.onError(
          error instanceof Error ? error.message : 'The voice model could not be loaded.',
        );
      });
  }

  /** Everything recognised so far. */
  get text(): string {
    return [...this.finished, this.partial].filter(Boolean).join(' ').trim();
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (this.closed) return;
    if (this.recognizer) {
      this.recognizer.acceptWaveformFloat(samples, sampleRate);
      return;
    }
    this.queuedSeconds += samples.length / sampleRate;
    if (this.queuedSeconds <= MAX_QUEUED_SECONDS) this.queue.push([samples, sampleRate]);
  }

  /** Flushes the recognizer and returns the final text of the utterance. */
  async finish(timeoutMs = 3000): Promise<string> {
    await this.ready;
    const recognizer = this.recognizer;
    if (!recognizer || this.closed) return this.finalText();
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, timeoutMs);
      this.waiter = () => {
        window.clearTimeout(timer);
        resolve();
      };
      recognizer.retrieveFinalResult();
    });
    this.waiter = null;
    return this.finalText();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    try {
      this.recognizer?.remove();
    } catch {
      // The worker may already be gone when the model was released.
    }
    this.recognizer = null;
  }

  private finalText(): string {
    return [...this.finished, this.partial].filter(Boolean).join(' ').trim();
  }

  private emit(): void {
    this.handlers.onText(this.text);
  }
}

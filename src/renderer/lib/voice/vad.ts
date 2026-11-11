export interface EndpointOptions {
  /** Silence after speech that ends the utterance. Spec: ~1.2 s. */
  silenceMs: number;
  /** Hard cap for one utterance. Spec: 15 s. */
  maxUtteranceMs: number;
  /** Give up when nothing was said at all. */
  noSpeechMs: number;
  /** Ignore blips shorter than this when deciding that speech started. */
  minSpeechMs: number;
}

export const DEFAULT_ENDPOINT_OPTIONS: EndpointOptions = {
  silenceMs: 1200,
  maxUtteranceMs: 15_000,
  noSpeechMs: 8000,
  minSpeechMs: 120,
};

export type EndpointEvent = 'none' | 'speech-start' | 'speech-end' | 'max-duration' | 'no-speech';

const MIN_THRESHOLD = 0.012;
const FLOOR_MARGIN = 3.2;

/**
 * Energy based voice activity detection with an adaptive noise floor. Feed it one RMS value
 * (0..1) per animation frame together with the frame time; it reports when speech started and
 * when the utterance ended (silence timeout, maximum length or nothing said).
 */
export class EndpointDetector {
  private elapsedMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private candidateMs = 0;
  private speaking = false;
  private floor = 0.004;
  private finished = false;

  constructor(private readonly options: EndpointOptions = DEFAULT_ENDPOINT_OPTIONS) {}

  get hasSpeech(): boolean {
    return this.speaking || this.speechMs > 0;
  }

  /** Milliseconds of speech heard so far. */
  get speechDurationMs(): number {
    return this.speechMs;
  }

  get threshold(): number {
    return Math.max(MIN_THRESHOLD, this.floor * FLOOR_MARGIN);
  }

  reset(): void {
    this.elapsedMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.candidateMs = 0;
    this.speaking = false;
    this.floor = 0.004;
    this.finished = false;
  }

  push(rms: number, dtMs: number): EndpointEvent {
    if (this.finished) return 'none';
    this.elapsedMs += dtMs;

    // Track the quietest recent level as the noise floor (rises slowly, falls quickly).
    this.floor = rms < this.floor ? rms : this.floor + (rms - this.floor) * 0.0015;

    if (this.elapsedMs >= this.options.maxUtteranceMs) return this.finish('max-duration');

    if (rms > this.threshold) {
      this.silenceMs = 0;
      this.candidateMs += dtMs;
      if (this.speaking) {
        this.speechMs += dtMs;
        return 'none';
      }
      if (this.candidateMs >= this.options.minSpeechMs) {
        this.speaking = true;
        this.speechMs = this.candidateMs;
        return 'speech-start';
      }
      return 'none';
    }

    this.candidateMs = 0;
    if (this.speaking) {
      this.silenceMs += dtMs;
      if (this.silenceMs >= this.options.silenceMs) return this.finish('speech-end');
      return 'none';
    }
    if (this.elapsedMs >= this.options.noSpeechMs) return this.finish('no-speech');
    return 'none';
  }

  private finish(event: Exclude<EndpointEvent, 'none' | 'speech-start'>): EndpointEvent {
    this.finished = true;
    return event;
  }
}

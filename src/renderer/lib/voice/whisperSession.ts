import type { TranscribeResult } from '@shared/ipc/types';
import { concatChunks, normalizeLevel, resampleTo16k, WHISPER_RATE } from './audio';
import type { RecognitionHandlers } from './recognizer';

/** Whisper sometimes "hears" these when it is given audio without real speech. */
const PHANTOMS = new Set([
  'you',
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'bye',
  'okay',
  'ok',
  '.',
  'धन्यवाद',
  'शुक्रिया',
  'thank you very much',
]);

export function isPhantomTranscript(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[\s.!?,।]+$/g, '')
    .replace(/^[\s.!?,।]+/g, '')
    .trim();
  if (normalized === '') return true;
  if (PHANTOMS.has(normalized)) return true;
  return /^[[(].*[\])]$/.test(normalized);
}

/** Longest recording sent for recognition (the main process accepts 60 s). */
const MAX_SECONDS = 58;
/** Shorter recordings cannot contain a command. */
const MIN_SECONDS = 0.25;

export type Transcribe = (samples: Float32Array<ArrayBuffer>) => Promise<TranscribeResult>;

/**
 * One utterance of Whisper recognition. Whisper decodes a finished recording (it has no streaming
 * mode), so this session buffers the microphone and sends everything when the utterance ends.
 */
export class WhisperRecognitionSession {
  private readonly chunks: Float32Array<ArrayBuffer>[] = [];
  private rate: number = WHISPER_RATE;
  private seconds = 0;
  private result = '';
  private closed = false;

  constructor(
    private readonly transcribe: Transcribe,
    private readonly handlers: RecognitionHandlers,
    /** Seconds of the utterance that were actual speech (from the voice activity detector). */
    private readonly speechSeconds: () => number = () => Number.POSITIVE_INFINITY,
  ) {}

  /** The final text (empty until `finish` ran): Whisper has no live partial results. */
  get text(): string {
    return this.result;
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (this.closed || this.seconds >= MAX_SECONDS) return;
    this.rate = sampleRate;
    this.chunks.push(samples.slice());
    this.seconds += samples.length / sampleRate;
  }

  async finish(): Promise<string> {
    if (this.closed) return this.result;
    const audio = normalizeLevel(resampleTo16k(concatChunks(this.chunks), this.rate));
    this.chunks.length = 0;
    if (audio.length < MIN_SECONDS * WHISPER_RATE) return '';
    try {
      const { text } = await this.transcribe(audio);
      const clean = text.trim();
      // A phantom phrase after a very short burst of sound is noise, not a request.
      const phantom = isPhantomTranscript(clean) && this.speechSeconds() < 1.2;
      this.result = phantom ? '' : clean;
    } catch (error) {
      this.handlers.onError(error instanceof Error ? error.message : 'Recognition failed.');
      this.result = '';
    }
    return this.result;
  }

  close(): void {
    this.closed = true;
    this.chunks.length = 0;
  }
}

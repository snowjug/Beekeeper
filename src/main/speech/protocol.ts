/** Messages between the main process and a speech worker thread (types only). */

export type WhisperSize = 'small' | 'base';

export type WorkerRequest =
  | { id: number; type: 'loadTts'; dir: string; threads: number }
  | { id: number; type: 'loadStt'; size: WhisperSize; dir: string; threads: number }
  | {
      id: number;
      type: 'synthesize';
      text: string;
      lang: 'en' | 'hi';
      sid: number;
      speed: number;
    }
  | {
      id: number;
      type: 'transcribe';
      samples: Float32Array;
      /** '' lets Whisper detect the language. */
      language: '' | 'en' | 'hi';
    };

export type WorkerResult =
  | { type: 'loaded'; ms: number }
  | { type: 'synthesized'; samples: Float32Array; sampleRate: number; ms: number }
  | { type: 'transcribed'; text: string; lang: string; ms: number };

export type WorkerResponse =
  { id: number; ok: true; result: WorkerResult } | { id: number; ok: false; error: string };

/** Request without the id (the client assigns it). */
export type WorkerRequestBody = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

export type ResultOf<T extends WorkerResult['type']> = Extract<WorkerResult, { type: T }>;

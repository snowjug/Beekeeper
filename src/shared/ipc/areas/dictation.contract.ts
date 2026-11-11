/** IPC schemas and payload types of dictation anywhere. */
import { z } from 'zod';
import { MAX_TRANSCRIBE_SECONDS, SPEECH_SAMPLE_RATE } from './speech.contract';

const out = <T>() => z.custom<T>();

export interface DictationStart {
  language: 'auto' | 'en' | 'hi';
  micDeviceId: string;
  /** Silence (ms) after speech that ends the dictation. */
  silenceMs: number;
  /** Hard limit of one dictation in seconds. */
  maxSeconds: number;
  earcons: boolean;
  theme: 'light' | 'dark';
  /** Accelerator that finishes the dictation (shown in the hint); null when it is not registered. */
  hotkey: string | null;
}

export type DictationPhase =
  'listening' | 'transcribing' | 'typing' | 'done' | 'error' | 'cancelled';

export interface DictationStatus {
  phase: DictationPhase;
  /** Transcript (phase 'typing' and 'done') or a hint. */
  text?: string;
  message?: string;
}

/** Why the pill gave up before it had audio to submit. */
export type DictationAbortReason =
  'no-speech' | 'mic-denied' | 'mic-missing' | 'mic-busy' | 'error';

export const DICTATION_ABORT_REASONS = [
  'no-speech',
  'mic-denied',
  'mic-missing',
  'mic-busy',
  'error',
] as const satisfies readonly DictationAbortReason[];

export interface DictationSubmitResult {
  ok: boolean;
  text?: string;
  message?: string;
}

export const dictationInvokeSchemas = {
  'dictation:ready': { input: z.void(), output: z.void() },
  'dictation:submit': {
    input: z.object({
      samples: z
        .instanceof(Float32Array)
        .refine(
          (samples) =>
            samples.length >= SPEECH_SAMPLE_RATE / 10 &&
            samples.length <= SPEECH_SAMPLE_RATE * MAX_TRANSCRIBE_SECONDS,
          'Recording length is out of range',
        ),
    }),
    output: out<DictationSubmitResult>(),
  },
  'dictation:cancel': { input: z.void(), output: z.void() },
  'dictation:abort': {
    input: z.object({
      reason: z.enum(DICTATION_ABORT_REASONS),
      message: z.string().max(300).optional(),
    }),
    output: z.void(),
  },
};

export const dictationEventSchemas = {
  'dictation:start': out<DictationStart>(),
  'dictation:stop': out<{ submit: boolean }>(),
  'dictation:status': out<DictationStatus>(),
};

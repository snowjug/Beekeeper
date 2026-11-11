/** IPC schemas and payload types of the speech area. */
import { z } from 'zod';
import { SPEECH_PACK_IDS, type SpeechPackId } from '../../speech/packs';
import { NATURAL_VOICE_IDS } from '../../speech/voices';

const out = <T>() => z.custom<T>();

export const SPEECH_SAMPLE_RATE = 16_000;
/** Longest recording accepted for recognition (Whisper decodes at most 30 s per window). */
export const MAX_TRANSCRIBE_SECONDS = 60;

export interface SpeechPackState {
  id: SpeechPackId;
  state: 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  message?: string;
}

export interface SpeechState {
  packs: Record<SpeechPackId, SpeechPackState>;
  /** The on-device speech engine (worker thread that holds the models in memory). */
  engine: 'idle' | 'loading' | 'ready' | 'error';
  engineMessage?: string;
  loaded: { tts: boolean; stt: 'small' | 'base' | null };
}

export interface SynthesizeResult {
  /** f32 = little-endian 32-bit float mono PCM, mp3 = encoded audio (ElevenLabs). */
  format: 'f32' | 'mp3';
  sampleRate: number;
  data: ArrayBuffer;
  durationMs: number;
  engine: 'natural' | 'elevenlabs';
  lang: 'en' | 'hi';
  /** Milliseconds the synthesis took (for latency tracking). */
  elapsedMs: number;
}

export interface TranscribeResult {
  text: string;
  /** Language Whisper decoded in ('en', 'hi', ...). */
  lang: string;
  model: 'small' | 'base';
  durationMs: number;
  /** Length of the recording in milliseconds. */
  audioMs: number;
}

const packId = z.enum(SPEECH_PACK_IDS);
const speechLanguage = z.enum(['auto', 'en', 'hi']);

export const speechInvokeSchemas = {
  'speech:status': { input: z.void(), output: out<SpeechState>() },
  'speech:ensurePack': { input: z.object({ pack: packId }), output: out<SpeechState>() },
  'speech:cancelPack': { input: z.object({ pack: packId }), output: out<SpeechState>() },
  'speech:removePack': { input: z.object({ pack: packId }), output: out<SpeechState>() },
  'speech:preload': {
    input: z.object({ tts: z.boolean().optional(), stt: z.boolean().optional() }),
    output: z.void(),
  },
  'speech:synthesize': {
    input: z.object({
      text: z.string().min(1).max(4000),
      lang: speechLanguage.default('auto'),
      voice: z.enum(NATURAL_VOICE_IDS).optional(),
      speed: z.number().min(0.5).max(2).optional(),
    }),
    output: out<SynthesizeResult>(),
  },
  'speech:transcribe': {
    input: z.object({
      /** 16 kHz mono float PCM in the range -1..1. */
      samples: z
        .instanceof(Float32Array)
        .refine(
          (samples) =>
            samples.length >= SPEECH_SAMPLE_RATE / 10 &&
            samples.length <= SPEECH_SAMPLE_RATE * MAX_TRANSCRIBE_SECONDS,
          'Recording length is out of range',
        ),
      language: speechLanguage.optional(),
    }),
    output: out<TranscribeResult>(),
  },
};

export const speechEventSchemas = {
  'speech:state': out<SpeechState>(),
};

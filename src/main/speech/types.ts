import type { SpeechPackId } from '@shared/speech/packs';
import type { NaturalVoiceId } from '@shared/speech/voices';
import type {
  AiTestResult,
  SpeechState,
  SynthesizeResult,
  TranscribeResult,
} from '@shared/ipc/types';

export interface SynthesizeRequest {
  text: string;
  lang: 'auto' | 'en' | 'hi';
  voice?: NaturalVoiceId;
  speed?: number;
}

export interface TranscribeRequest {
  /** 16 kHz mono float PCM, -1..1. */
  samples: Float32Array;
  language?: 'auto' | 'en' | 'hi';
}

/** On-device speech: natural text-to-speech and Whisper recognition behind one lifecycle. */
export interface SpeechService {
  status(): SpeechState;
  ensurePack(id: SpeechPackId): Promise<SpeechState>;
  cancelPack(id: SpeechPackId): SpeechState;
  removePack(id: SpeechPackId): Promise<SpeechState>;
  /** Loads the models in the background so the first request is fast. */
  preload(options: { tts?: boolean; stt?: boolean }): Promise<void>;
  synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
  /** Speaks a few characters with the saved ElevenLabs key and voice to check they work. */
  testElevenLabs(): Promise<AiTestResult>;
  onState(listener: (state: SpeechState) => void): () => void;
  dispose(): Promise<void>;
}

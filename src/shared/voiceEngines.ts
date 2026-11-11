import type { Settings } from './settings';
import { whisperPackFor, type SpeechPackId } from './speech/packs';

/** What is actually usable right now (downloaded models, saved keys). */
export interface EngineAvailability {
  /** Speech packs that are downloaded and verified. */
  packs: readonly SpeechPackId[];
  /** The small Vosk model (offline recognition and the wake word) is installed. */
  voskReady: boolean;
  azureSpeechConfigured: boolean;
  elevenLabsConfigured: boolean;
}

export type SttEngine = 'whisper' | 'offline' | 'azure' | 'none';
export type TtsEngine = 'natural' | 'elevenlabs' | 'azure' | 'system';

export interface ResolvedEngines {
  stt: SttEngine;
  /** Whisper model that serves recognition when `stt` is 'whisper'. */
  whisperModel: 'small' | 'base' | null;
  tts: TtsEngine;
  /** The configured recognition engine is not ready, another one stepped in. */
  sttFallback: boolean;
  ttsFallback: boolean;
}

/**
 * Picks the engines that will really be used. The configured engine wins when it is ready;
 * otherwise the next best ready engine takes over so the assistant never goes silent or deaf
 * just because a model is still downloading.
 */
export function resolveEngines(
  voice: Settings['voice'],
  available: EngineAvailability,
): ResolvedEngines {
  const ready = new Set<SpeechPackId>(available.packs);

  const preferred = whisperPackFor(voice.whisperModel);
  const otherModel = voice.whisperModel === 'small' ? 'base' : 'small';
  const whisperModel: 'small' | 'base' | null = ready.has(preferred)
    ? voice.whisperModel
    : ready.has(whisperPackFor(otherModel))
      ? otherModel
      : null;

  let stt: SttEngine;
  if (voice.sttEngine === 'azure' && available.azureSpeechConfigured) stt = 'azure';
  else if (voice.sttEngine === 'offline' && available.voskReady) stt = 'offline';
  else if (whisperModel !== null) stt = 'whisper';
  else if (available.voskReady) stt = 'offline';
  else stt = 'none';

  const naturalReady = ready.has('supertonic-3');
  let tts: TtsEngine;
  if (voice.ttsEngine === 'azure' && available.azureSpeechConfigured) tts = 'azure';
  else if (voice.ttsEngine === 'elevenlabs' && available.elevenLabsConfigured) tts = 'elevenlabs';
  else if (voice.ttsEngine === 'system') tts = 'system';
  else tts = naturalReady ? 'natural' : 'system';

  const sttFallback =
    (voice.sttEngine === 'whisper' && stt !== 'whisper') ||
    (voice.sttEngine === 'offline' && stt !== 'offline') ||
    (voice.sttEngine === 'azure' && stt !== 'azure') ||
    (voice.sttEngine === 'whisper' && stt === 'whisper' && whisperModel !== voice.whisperModel);
  const ttsFallback = tts !== voice.ttsEngine;

  return {
    stt,
    whisperModel: stt === 'whisper' ? whisperModel : null,
    tts,
    sttFallback,
    ttsFallback,
  };
}

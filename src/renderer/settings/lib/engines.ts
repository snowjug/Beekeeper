import type { SpeechPackState, SpeechState, VoiceModelState } from '@shared/ipc/types';
import type { SettingsView, VoiceLanguage } from '@shared/settings';
import { SPEECH_PACK_IDS, whisperPackFor, type SpeechPackId } from '@shared/speech/packs';
import {
  resolveEngines,
  type EngineAvailability,
  type ResolvedEngines,
  type SttEngine,
  type TtsEngine,
} from '@shared/voiceEngines';
import { speechConfigured } from './azure';

/** ElevenLabs needs both the API key and the voice to speak with. */
export function elevenLabsConfigured(view: SettingsView): boolean {
  return view.secrets.elevenLabsKey !== null && view.voice.elevenLabsVoiceId !== '';
}

/** What can actually be used right now: downloaded packs, the Vosk model and saved keys. */
export function availabilityOf(
  view: SettingsView,
  speech: SpeechState | null,
  model: VoiceModelState | null,
): EngineAvailability {
  return {
    packs: speech ? SPEECH_PACK_IDS.filter((id) => speech.packs[id].state === 'ready') : [],
    voskReady: model?.state === 'ready',
    azureSpeechConfigured: speechConfigured(view),
    elevenLabsConfigured: elevenLabsConfigured(view),
  };
}

export function resolveFor(
  view: SettingsView,
  speech: SpeechState | null,
  model: VoiceModelState | null,
): ResolvedEngines {
  return resolveEngines(view.voice, availabilityOf(view, speech, model));
}

const WORKING = new Set<SpeechPackState['state']>(['downloading', 'verifying', 'extracting']);

function packWorking(speech: SpeechState | null, pack: SpeechPackId): boolean {
  return speech !== null && WORKING.has(speech.packs[pack].state);
}

function whisperName(model: 'small' | 'base' | null): string {
  return model === 'base' ? 'Whisper fast' : 'Whisper accurate';
}

function sttName(engine: SttEngine, whisperModel: 'small' | 'base' | null): string {
  switch (engine) {
    case 'whisper':
      return whisperName(whisperModel);
    case 'offline':
      return 'the offline model';
    case 'azure':
      return 'Azure Speech';
    case 'none':
      return 'nothing';
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface FallbackNote {
  tone: 'info' | 'warning';
  text: string;
}

/**
 * Says what recognition is really used when the chosen engine is not ready yet ("Using the offline
 * model until Whisper accurate finishes downloading"); null when the choice is in use.
 */
export function describeSttFallback(
  view: SettingsView,
  resolved: ResolvedEngines,
  speech: SpeechState | null,
  model: VoiceModelState | null,
): FallbackNote | null {
  if (!resolved.sttFallback) return null;
  const { voice } = view;
  const wanted = sttName(voice.sttEngine, voice.whisperModel);
  const working =
    voice.sttEngine === 'whisper'
      ? packWorking(speech, whisperPackFor(voice.whisperModel))
      : voice.sttEngine === 'offline' && model?.state === 'downloading';
  const until = working
    ? `${wanted} finishes downloading`
    : voice.sttEngine === 'azure'
      ? 'Azure Speech is set up'
      : `${wanted} is downloaded`;

  if (resolved.stt === 'none') {
    return {
      tone: 'warning',
      text: working
        ? `${capitalize(wanted)} is still downloading. Until it finishes only typed commands work.`
        : 'No speech recognition is ready yet, so only typed commands work. Download one of the models above to use your voice.',
    };
  }
  return {
    tone: 'info',
    text: `Using ${sttName(resolved.stt, resolved.whisperModel)} until ${until}.`,
  };
}

function ttsName(engine: TtsEngine): string {
  switch (engine) {
    case 'natural':
      return 'the natural voice';
    case 'system':
      return 'the Windows voice';
    case 'elevenlabs':
      return 'ElevenLabs';
    case 'azure':
      return 'Azure';
  }
}

/** Same as `describeSttFallback` for the assistant's voice. Azure has its own setup hint. */
export function describeTtsFallback(
  view: SettingsView,
  resolved: ResolvedEngines,
  speech: SpeechState | null,
): FallbackNote | null {
  if (!resolved.ttsFallback) return null;
  const using = ttsName(resolved.tts);
  switch (view.voice.ttsEngine) {
    case 'natural':
      return {
        tone: 'info',
        text: packWorking(speech, 'supertonic-3')
          ? `Using ${using} until the natural voice finishes downloading.`
          : `Using ${using} until the natural voice is downloaded.`,
      };
    case 'elevenlabs':
      return {
        tone: 'info',
        text: `ElevenLabs needs an API key and a voice ID. Using ${using} until you add them.`,
      };
    case 'azure':
    case 'system':
      return null;
  }
}

/** The language dictation listens for ("Same as voice" follows the Voice page). */
export function dictationLanguage(view: SettingsView): VoiceLanguage {
  const { language } = view.dictation;
  return language === 'inherit' ? view.voice.language : language;
}

/** What is missing for dictation to work well: recognition that is not ready, or English-only recognition. */
export function describeDictationNotice(
  view: SettingsView,
  resolved: ResolvedEngines,
): FallbackNote | null {
  if (resolved.stt === 'none') {
    return {
      tone: 'warning',
      text: 'Dictation needs speech recognition and none is ready yet. Download Whisper under Voice.',
    };
  }
  if (resolved.stt === 'offline' && dictationLanguage(view) !== 'en') {
    return {
      tone: 'info',
      text: 'Dictation is using the offline model, which understands English only. Download Whisper under Voice to dictate in Hindi.',
    };
  }
  return null;
}

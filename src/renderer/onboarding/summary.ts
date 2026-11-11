import type { VoiceModelState } from '@shared/ipc/types';
import type { VoiceLanguage } from '@shared/settings';
import { percentOf } from './modelFormat';
import type { PackProgress } from './packFormat';
import type { MicTestState } from './types';

export type MicOutcome = 'heard' | 'silent' | 'problem' | 'skipped';
export type SummaryTone = 'good' | 'neutral' | 'warn';
/** Best = natural voice + Whisper; Light = the small offline model and the Windows voices. */
export type Quality = 'best' | 'light';

/** Once the user was heard the microphone is known to work, whatever a later retry does. */
export function micOutcomeOf(heard: boolean, state: MicTestState): MicOutcome {
  if (heard) return 'heard';
  if (state.status === 'error') return 'problem';
  return state.status === 'silent' ? 'silent' : 'skipped';
}

export interface SummaryItem {
  id: 'microphone' | 'language' | 'voice' | 'wakeWord';
  label: string;
  value: string;
  tone: SummaryTone;
}

export interface SetupSnapshot {
  mic: MicOutcome;
  language: VoiceLanguage;
  quality: Quality;
  /** Combined state of the natural voice + Whisper downloads; null while it has not been read. */
  best: PackProgress | null;
  /** The small offline model; null while its status has not been read (yet). */
  model: VoiceModelState | null;
  wakeWord: boolean;
}

function microphoneItem(mic: MicOutcome): SummaryItem {
  const label = 'Microphone';
  switch (mic) {
    case 'heard':
      return { id: 'microphone', label, value: 'Heard you loud and clear', tone: 'good' };
    case 'silent':
      return {
        id: 'microphone',
        label,
        value: 'Didn’t hear anything — check it in Settings > Voice',
        tone: 'warn',
      };
    case 'problem':
      return {
        id: 'microphone',
        label,
        value: 'Couldn’t open it — check Windows settings',
        tone: 'warn',
      };
    case 'skipped':
      return {
        id: 'microphone',
        label,
        value: 'Skipped — test it any time in Settings > Voice',
        tone: 'neutral',
      };
  }
}

const LANGUAGE_NAMES: Record<VoiceLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  auto: 'Hindi and English',
};

function languageItem(language: VoiceLanguage): SummaryItem {
  return { id: 'language', label: 'Language', value: LANGUAGE_NAMES[language], tone: 'good' };
}

function bestItem(best: PackProgress | null): SummaryItem {
  const label = 'Voice';
  if (!best) return { id: 'voice', label, value: 'Status unavailable', tone: 'neutral' };
  switch (best.phase) {
    case 'ready':
      return {
        id: 'voice',
        label,
        value: 'Ready — natural voice and accurate recognition',
        tone: 'good',
      };
    case 'downloading':
    case 'verifying':
      return {
        id: 'voice',
        label,
        value: `Downloading… ${best.percent}% — it keeps going in the background`,
        tone: 'neutral',
      };
    case 'partial':
      return {
        id: 'voice',
        label,
        value: `Paused at ${best.percent}% — resume it in Settings > Voice`,
        tone: 'neutral',
      };
    case 'error':
      return {
        id: 'voice',
        label,
        value: 'Download failed — try again in Settings > Voice',
        tone: 'warn',
      };
    case 'missing':
      return {
        id: 'voice',
        label,
        value: 'Skipped — download it any time in Settings > Voice',
        tone: 'neutral',
      };
  }
}

function lightItem(model: VoiceModelState | null): SummaryItem {
  const label = 'Voice';
  if (!model) return { id: 'voice', label, value: 'Status unavailable', tone: 'neutral' };
  const percent = percentOf(model.receivedBytes, model.totalBytes);
  switch (model.state) {
    case 'ready':
      return { id: 'voice', label, value: 'Ready — voice works offline', tone: 'good' };
    case 'downloading':
      return { id: 'voice', label, value: `Downloading… ${percent}%`, tone: 'neutral' };
    case 'partial':
      return {
        id: 'voice',
        label,
        value: `Paused at ${percent}% — resume it from the assistant`,
        tone: 'neutral',
      };
    case 'error':
      return {
        id: 'voice',
        label,
        value: 'Download failed — try again from the assistant',
        tone: 'warn',
      };
    case 'missing':
      return {
        id: 'voice',
        label,
        value: 'Skipped — the assistant offers it when you use voice',
        tone: 'neutral',
      };
  }
}

function wakeWordItem(wakeWord: boolean, model: VoiceModelState | null): SummaryItem {
  const label = 'Wake word';
  if (!wakeWord) {
    return {
      id: 'wakeWord',
      label,
      value: 'Off — turn it on in Settings > Voice',
      tone: 'neutral',
    };
  }
  if (model?.state === 'ready') {
    return { id: 'wakeWord', label, value: 'On — say “Hey Beekeeper”', tone: 'good' };
  }
  if (model?.state === 'missing' || model?.state === 'partial' || model?.state === 'error') {
    return {
      id: 'wakeWord',
      label,
      value: 'On — needs the small offline model: download it in Settings > Voice',
      tone: 'neutral',
    };
  }
  return {
    id: 'wakeWord',
    label,
    value: 'On — starts once the voice model is ready',
    tone: 'neutral',
  };
}

/** The recap shown on the last screen (microphone, language, voice, wake word). */
export function summarizeSetup({
  mic,
  language,
  quality,
  best,
  model,
  wakeWord,
}: SetupSnapshot): SummaryItem[] {
  return [
    microphoneItem(mic),
    languageItem(language),
    quality === 'best' ? bestItem(best) : lightItem(model),
    wakeWordItem(wakeWord, model),
  ];
}

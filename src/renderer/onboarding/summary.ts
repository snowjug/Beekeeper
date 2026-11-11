import type { VoiceModelState } from '@shared/ipc/types';
import { percentOf } from './modelFormat';
import type { MicTestState } from './types';

export type MicOutcome = 'heard' | 'silent' | 'problem' | 'skipped';
export type SummaryTone = 'good' | 'neutral' | 'warn';

/** Once the user was heard the microphone is known to work, whatever a later retry does. */
export function micOutcomeOf(heard: boolean, state: MicTestState): MicOutcome {
  if (heard) return 'heard';
  if (state.status === 'error') return 'problem';
  return state.status === 'silent' ? 'silent' : 'skipped';
}

export interface SummaryItem {
  id: 'microphone' | 'model' | 'wakeWord';
  label: string;
  value: string;
  tone: SummaryTone;
}

export interface SetupSnapshot {
  mic: MicOutcome;
  /** Null while the model status has not been read (yet). */
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

function modelItem(model: VoiceModelState | null): SummaryItem {
  const label = 'Voice model';
  if (!model) return { id: 'model', label, value: 'Status unavailable', tone: 'neutral' };
  const percent = percentOf(model.receivedBytes, model.totalBytes);
  switch (model.state) {
    case 'ready':
      return { id: 'model', label, value: 'Ready — voice works offline', tone: 'good' };
    case 'downloading':
      return { id: 'model', label, value: `Downloading… ${percent}%`, tone: 'neutral' };
    case 'partial':
      return {
        id: 'model',
        label,
        value: `Paused at ${percent}% — resume it from the assistant`,
        tone: 'neutral',
      };
    case 'error':
      return {
        id: 'model',
        label,
        value: 'Download failed — try again from the assistant',
        tone: 'warn',
      };
    case 'missing':
      return {
        id: 'model',
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
  return {
    id: 'wakeWord',
    label,
    value: 'On — starts once the voice model is ready',
    tone: 'neutral',
  };
}

/** The recap shown on the last screen (microphone, voice model, wake word). */
export function summarizeSetup({ mic, model, wakeWord }: SetupSnapshot): SummaryItem[] {
  return [microphoneItem(mic), modelItem(model), wakeWordItem(wakeWord, model)];
}

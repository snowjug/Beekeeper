import type { WorkerStatus } from '@shared/ipc/types';
import type { NoticeTone } from './components/Notice';

export interface WakeHint {
  tone: NoticeTone;
  text: string;
}

export interface WakeHintInput {
  wakeWord: boolean;
  modelReady: boolean;
  /** The small offline model is being downloaded right now (so the wake word will start soon). */
  modelDownloading?: boolean;
  /** Latest report of the wake-word worker, if any. */
  worker: WorkerStatus | null;
}

/**
 * The line under the "Hey Beekeeper" switch. Without the small offline model the switch still works
 * (the choice is saved), so the hint says what is needed; with it, the worker's own status is shown.
 */
export function describeWakeHint({
  wakeWord,
  modelReady,
  modelDownloading = false,
  worker,
}: WakeHintInput): WakeHint | null {
  if (!modelReady) {
    if (modelDownloading) {
      return {
        tone: 'info',
        text: wakeWord
          ? 'Saved. It starts listening as soon as the voice model is ready.'
          : 'Needs the voice model. You can turn it on now — it starts working once the model is ready.',
      };
    }
    return {
      tone: 'info',
      text: wakeWord
        ? 'Saved. It needs the small offline model (about 40 MB): download it in Settings > Voice and it starts right away.'
        : 'Needs the small offline model (about 40 MB). You can turn it on now and download the model later in Settings > Voice.',
    };
  }
  if (!wakeWord) return null;
  switch (worker?.state) {
    case 'armed':
      return { tone: 'good', text: 'Listening for “Hey Beekeeper”.' };
    case 'loading':
      return { tone: 'info', text: 'Getting ready…' };
    case 'paused':
      return { tone: 'info', text: 'Paused for now to save battery.' };
    case 'error':
      return { tone: 'bad', text: worker.message ?? 'The wake word couldn’t start.' };
    case 'off':
    case undefined:
      return null;
  }
}

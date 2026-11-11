import type { DictationAbortReason } from '@shared/ipc/types';

/** What the pill says. Short on purpose: the pill is a few hundred pixels wide. */
export const MESSAGES = {
  disabled: 'Dictation is off in Settings',
  noModel: 'Download the voice model in Settings > Voice',
  engine: 'The speech engine could not start. See Settings > Voice',
  nothingHeard: "I didn't catch that. Try again",
  noTarget: 'Click where you want to type, then try again',
  copied: 'Copied — press Ctrl+V',
  lost: "Couldn't type or copy that. Try again",
  failed: 'Dictation hit a problem. Try again',
  unresponsive: 'The dictation window did not respond. Try again',
  micDenied: 'Microphone access is off. Allow it in Windows Settings',
  micMissing: 'No microphone found. Pick one in Settings > Voice',
  micBusy: 'Another app is using the microphone',
} as const;

/** Turns a failed transcription into something to show; the raw error stays in the log. */
export function transcribeErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (/not installed|download (?:it|the)|no (?:speech )?(?:recognition )?model/i.test(text)) {
    return MESSAGES.noModel;
  }
  if (/could not start|reinstall|engine/i.test(text)) return MESSAGES.engine;
  return MESSAGES.failed;
}

export function abortMessage(reason: DictationAbortReason): string {
  switch (reason) {
    case 'no-speech':
      return MESSAGES.nothingHeard;
    case 'mic-denied':
      return MESSAGES.micDenied;
    case 'mic-missing':
      return MESSAGES.micMissing;
    case 'mic-busy':
      return MESSAGES.micBusy;
    case 'error':
      return MESSAGES.failed;
  }
}

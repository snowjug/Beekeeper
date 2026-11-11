import type { DictationPhase, DictationStart } from '@shared/ipc/types';

/** The few words of the transcript the pill shows ("Hello, how are you…"). */
export function firstWords(text: string, count = 7): string {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  const head = words.slice(0, count).join(' ');
  return words.length > count ? `${head}…` : head;
}

/** What the language badge shows. */
export function languageBadge(language: DictationStart['language']): string {
  switch (language) {
    case 'en':
      return 'EN';
    case 'hi':
      return 'हि';
    case 'auto':
      return 'Auto';
  }
}

export function languageName(language: DictationStart['language']): string {
  switch (language) {
    case 'en':
      return 'English';
    case 'hi':
      return 'Hindi';
    case 'auto':
      return 'Automatic language';
  }
}

/** The hint under "Listening…", using the hotkey that really works. */
export function hintFor(hotkey: string | null): string {
  return hotkey
    ? `Press ${hotkey} to finish · Esc to cancel`
    : 'Click the microphone to finish · Esc to cancel';
}

export interface PillTextInput {
  phase: DictationPhase;
  /** The microphone is still opening. */
  preparing?: boolean;
  /** The speaker has said something. */
  speaking: boolean;
  hotkey: string | null;
  text: string;
  message: string;
}

/** The two lines of the pill for each phase. */
export function describePill(input: PillTextInput): { title: string; subtitle: string } {
  const words = firstWords(input.text);
  switch (input.phase) {
    case 'listening':
      if (input.preparing) {
        return { title: 'Starting the microphone…', subtitle: hintFor(input.hotkey) };
      }
      return {
        title: input.speaking ? 'Listening…' : 'Listening… speak now',
        subtitle: hintFor(input.hotkey),
      };
    case 'transcribing':
      return { title: 'Transcribing…', subtitle: 'On your PC, nothing is uploaded' };
    case 'typing':
      return { title: 'Typing…', subtitle: words };
    case 'done':
      return { title: input.message || 'Typed', subtitle: words };
    case 'error':
      return { title: input.message || 'Dictation hit a problem. Try again', subtitle: '' };
    case 'cancelled':
      return { title: 'Cancelled', subtitle: '' };
  }
}

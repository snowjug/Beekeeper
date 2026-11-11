import { MIC_ERROR_HELP } from '@renderer/lib/voice/mic';
import type { MicTestState } from './types';

export const SILENT_TEXT =
  'I didn’t hear anything. Check that the right microphone is selected, then try again.';

export type MicStatusTone = 'neutral' | 'active' | 'good' | 'warn' | 'bad';

export interface MicStatus {
  tone: MicStatusTone;
  text: string;
}

/** The one-line status under the level meter. */
export function describeMicStatus(state: MicTestState): MicStatus {
  switch (state.status) {
    case 'idle':
      return {
        tone: 'neutral',
        text: 'Press “Allow & test microphone”, then say something.',
      };
    case 'requesting':
      return { tone: 'active', text: 'Waiting for Windows to open your microphone…' };
    case 'listening':
      return { tone: 'active', text: 'Say something…' };
    case 'heard':
      return { tone: 'good', text: 'I can hear you' };
    case 'silent':
      return { tone: 'warn', text: SILENT_TEXT };
    case 'error':
      return { tone: 'bad', text: MIC_ERROR_HELP[state.kind] };
  }
}

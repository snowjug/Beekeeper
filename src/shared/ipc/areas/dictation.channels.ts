/** IPC channel allow-lists of dictation anywhere (zod-free). */
import type { WindowRole } from '../../windows';

type Roles = readonly WindowRole[];

export const DICTATION_INVOKE = {
  /** The pill page loaded and is ready to receive `dictation:start`. */
  'dictation:ready': ['dictation'],
  /** Recorded audio of one dictation; main transcribes it and types the text. */
  'dictation:submit': ['dictation'],
  'dictation:cancel': ['dictation'],
  /** The pill cannot record (no microphone, nothing heard): main shows the reason and ends. */
  'dictation:abort': ['dictation'],
} as const satisfies Record<string, Roles>;

export const DICTATION_EVENTS = {
  'dictation:start': ['dictation'],
  'dictation:stop': ['dictation'],
  'dictation:status': ['dictation'],
} as const satisfies Record<string, Roles>;

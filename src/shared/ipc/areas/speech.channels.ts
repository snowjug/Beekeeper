/** IPC channel allow-lists of the speech area (zod-free: preload scripts import this file). */
import type { WindowRole } from '../../windows';

type Roles = readonly WindowRole[];

export const SPEECH_INVOKE = {
  'speech:status': ['assistant', 'onboarding', 'settings', 'dictation'],
  'speech:ensurePack': ['assistant', 'onboarding', 'settings'],
  'speech:cancelPack': ['assistant', 'onboarding', 'settings'],
  'speech:removePack': ['settings'],
  /** Loads the models in the background (the assistant bar opens, dictation starts). */
  'speech:preload': ['assistant', 'dictation', 'settings', 'onboarding'],
  'speech:synthesize': ['assistant', 'settings', 'onboarding', 'dictation', 'circle', 'studio'],
  'speech:transcribe': ['assistant', 'dictation', 'settings', 'onboarding'],
} as const satisfies Record<string, Roles>;

export const SPEECH_EVENTS = {
  'speech:state': ['assistant', 'onboarding', 'settings', 'dictation'],
} as const satisfies Record<string, Roles>;

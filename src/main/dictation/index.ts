import type { FeatureDeps } from '../features/types';
import { registerUnimplemented } from '../features/unimplemented';

export interface DictationFeature {
  /** Starts dictation, or finishes it when it is already listening. */
  toggle(source: 'hotkey' | 'tray' | 'voice'): void;
  readonly active: boolean;
  dispose(): void;
}

/** Placeholder until dictation is implemented: every channel answers "not available". */
export function createDictation(deps: FeatureDeps): DictationFeature {
  registerUnimplemented(deps.router, ['dictation:ready', 'dictation:submit', 'dictation:cancel']);
  return {
    toggle: () => deps.ctx.logger.warn('Dictation is not available in this build'),
    active: false,
    dispose: () => undefined,
  };
}

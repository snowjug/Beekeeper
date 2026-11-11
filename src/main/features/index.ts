import type { HotkeyId } from '@shared/ipc/types';
import { createDictation, type DictationFeature } from '../dictation';
import { createSpeech } from '../speech';
import type { SpeechService } from '../speech/types';
import { createStudio, type StudioFeature } from '../studio';
import type { BaseFeatureDeps } from './types';

export type { BaseFeatureDeps, FeatureDeps } from './types';

export interface Features {
  speech: SpeechService;
  studio: StudioFeature;
  dictation: DictationFeature;
  /** Runs the action of a hotkey owned by a feature; false when the hotkey is not handled here. */
  onHotkey(id: HotkeyId): boolean;
  dispose(): Promise<void>;
}

/** Creates the feature modules, registers their IPC handlers and returns their handles. */
export function createFeatures(base: BaseFeatureDeps): Features {
  const speech = createSpeech(base);
  const deps = { ...base, speech };
  const studio = createStudio(deps);
  const dictation = createDictation(deps);

  return {
    speech,
    studio,
    dictation,
    onHotkey(id) {
      if (id === 'capture') {
        void studio.capture('hotkey');
        return true;
      }
      if (id === 'dictation') {
        dictation.toggle('hotkey');
        return true;
      }
      return false;
    },
    async dispose() {
      dictation.dispose();
      studio.dispose();
      await speech.dispose();
    },
  };
}

import { SPEECH_PACK_IDS, SPEECH_PACKS, type SpeechPackId } from '@shared/speech/packs';
import type { SpeechPackState, SpeechState } from '@shared/ipc/types';
import type { BaseFeatureDeps } from '../features/types';
import { registerUnimplemented } from '../features/unimplemented';
import type { SpeechService } from './types';

export type { SpeechService } from './types';

function missingState(): SpeechState {
  const packs = Object.fromEntries(
    SPEECH_PACK_IDS.map((id): [SpeechPackId, SpeechPackState] => [
      id,
      {
        id,
        state: 'missing',
        receivedBytes: 0,
        totalBytes: SPEECH_PACKS[id].sizeBytes,
        bytesPerSecond: 0,
        etaSeconds: null,
      },
    ]),
  ) as Record<SpeechPackId, SpeechPackState>;
  return { packs, engine: 'idle', loaded: { tts: false, stt: null } };
}

/** Placeholder until the speech engine is implemented. */
export function createSpeech(deps: BaseFeatureDeps): SpeechService {
  registerUnimplemented(deps.router, [
    'speech:status',
    'speech:ensurePack',
    'speech:cancelPack',
    'speech:removePack',
    'speech:preload',
    'speech:synthesize',
    'speech:transcribe',
  ]);
  const unavailable = (): Promise<never> => Promise.reject(new Error('Speech is not available'));
  return {
    status: missingState,
    ensurePack: unavailable,
    cancelPack: missingState,
    removePack: () => Promise.resolve(missingState()),
    preload: () => Promise.resolve(),
    synthesize: unavailable,
    transcribe: unavailable,
    testElevenLabs: () => Promise.resolve({ ok: false, message: 'Speech is not available' }),
    onState: () => () => undefined,
    dispose: () => Promise.resolve(),
  };
}

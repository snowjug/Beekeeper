import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { BaseFeatureDeps } from '../features/types';
import { resolveSpeechWorker } from './assets';
import { SpeechEngine } from './engine';
import { registerSpeechHandlers } from './handlers';
import { SpeechPackManager } from './packManager';
import type { SpeechService } from './types';
import { createWorkerThread } from './workerClient';

export type { SpeechService } from './types';

/** Half of the logical processors (2-4): the models never starve the rest of the desktop. */
export function speechThreads(): number {
  return Math.min(4, Math.max(2, Math.floor(availableParallelism() / 2)));
}

/** Creates the on-device speech engine (natural voice + Whisper) and its IPC handlers. */
export function createSpeech(deps: BaseFeatureDeps): SpeechService {
  const { ctx, router, netFetch } = deps;
  const packs = new SpeechPackManager({
    rootDir: join(ctx.paths.modelsDir, 'speech'),
    fetch: netFetch,
    logger: ctx.logger,
  });
  const workerPath = resolveSpeechWorker(ctx.paths.rendererRoot, ctx.packaged);
  const engine = new SpeechEngine({
    packs,
    createWorker: () => createWorkerThread(workerPath, ctx.logger),
    settings: () => ctx.settings.get(),
    keys: ctx.keys,
    fetch: netFetch,
    logger: ctx.logger,
    threads: speechThreads(),
  });
  engine.onState((state) => ctx.windows.broadcast('speech:state', state));
  registerSpeechHandlers(router, engine);
  return engine;
}

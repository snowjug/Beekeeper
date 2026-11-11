import type { VoiceModelState } from '@shared/ipc/types';
import {
  getModelUrlPath,
  modelManifest,
  type ModelProgress,
  type ModelStatus,
} from '@shared/models';
import { APP_ORIGIN } from '@shared/windows';

/**
 * Maps the model manager's status/progress to the shape the renderers use.
 *
 * A failed download reports its `error` progress while the run is still "downloading", so the
 * progress decides in that one case. A cancelled download also emits an `error` progress, but its
 * status is already idle (`partial`/`missing`): that is a pause, not a failure, and stays resumable.
 */
export function toVoiceModelState(
  status: ModelStatus,
  progress: ModelProgress | null,
): VoiceModelState {
  const downloading = progress !== null && status.state === 'downloading';
  const state: VoiceModelState['state'] =
    progress?.phase === 'error' && status.state === 'downloading' ? 'error' : status.state;
  const idle = status.state === 'partial' || status.state === 'missing';
  const message = status.message ?? (idle ? undefined : progress?.message);
  return {
    state,
    receivedBytes: status.receivedBytes,
    totalBytes: status.totalBytes,
    bytesPerSecond: downloading ? progress.bytesPerSecond : 0,
    etaSeconds: downloading ? progress.etaSeconds : null,
    attempt: downloading ? progress.attempt : 1,
    maxAttempts: downloading ? progress.maxAttempts : 1,
    ...(message ? { message } : {}),
    modelUrl: status.state === 'ready' ? `${APP_ORIGIN}${getModelUrlPath()}` : null,
    displayName: modelManifest.displayName,
  };
}

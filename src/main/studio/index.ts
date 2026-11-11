import type { StudioSource } from '@shared/ipc/types';
import type { FeatureDeps } from '../features/types';
import { registerUnimplemented } from '../features/unimplemented';

export interface StudioFeature {
  /** Captures the display under the cursor and opens Capture Studio with the result. */
  capture(source: StudioSource): Promise<void>;
  /** Opens Capture Studio for a screenshot that was already saved to disk. */
  openFile(
    shot: { path: string; width: number; height: number },
    source?: StudioSource,
  ): Promise<void>;
  /** Opens a PNG that is already in memory (a Circle to Search selection). */
  openImage(
    png: Buffer,
    size: { width: number; height: number },
    source?: StudioSource,
  ): Promise<void>;
  /** Closes the Studio and every pinned screenshot. */
  dispose(): void;
}

/** Placeholder until Capture Studio is implemented: every channel answers "not available". */
export function createStudio(deps: FeatureDeps): StudioFeature {
  registerUnimplemented(deps.router, [
    'capture:start',
    'studio:getSession',
    'studio:ready',
    'studio:copy',
    'studio:save',
    'studio:pin',
    'studio:wallpaper',
    'studio:share',
    'studio:assist',
    'studio:delete',
    'studio:openFolder',
    'studio:close',
    'pin:getInfo',
    'pin:action',
  ]);
  const unavailable = (): Promise<void> => {
    deps.ctx.logger.warn('Capture Studio is not available in this build');
    return Promise.resolve();
  };
  return {
    capture: unavailable,
    openFile: unavailable,
    openImage: unavailable,
    dispose: () => undefined,
  };
}

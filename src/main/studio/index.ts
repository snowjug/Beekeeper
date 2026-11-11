import { randomUUID } from 'node:crypto';
import { join, win32 } from 'node:path';
import type { StudioSource } from '@shared/ipc/types';
import type { FeatureDeps } from '../features/types';
import { defaultExecFile, defaultSpawnDetached, resolveSystemPaths } from '../system/exec';
import { createPowerShellRunner } from '../system/powershell';
import { createWallpaperApi } from '../system/wallpaper';
import { StudioActions } from './actions';
import { createAssist } from './assist';
import { StudioController } from './controller';
import { nodeStudioFs, saveFolders, writeNewScreenshot } from './files';
import { registerStudioHandlers } from './handlers';
import { PinManager } from './pins';
import {
  createElectronPlatform,
  createPinWindows,
  createStudioWindows,
  hideWindowOf,
} from './platform.electron';
import type { StudioSettings } from './session';
import { createShareActions } from './share';

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

/**
 * Capture Studio: the preview that opens after a screenshot (frame, toolbar, edit, pin, share) and
 * the pinned screenshots. Nothing exists until the first capture: no window, no timers.
 */
export function createStudio(deps: FeatureDeps): StudioFeature {
  const { ctx, router, captures, ocr, captureScreen } = deps;
  const logger = ctx.logger.scope('studio');
  const platform = createElectronPlatform(ctx.windows);
  const systemPaths = resolveSystemPaths(process.env);

  const settings = (): StudioSettings => ({
    capture: ctx.settings.get().capture,
    aiAvailable: ctx.ai.isConfigured(),
  });
  const saveNew = (png: Buffer): Promise<string> =>
    writeNewScreenshot(
      nodeStudioFs,
      saveFolders(settings().capture.saveFolder, ctx.paths.picturesDir),
      png,
      new Date(),
    );

  const controller = new StudioController({
    windows: createStudioWindows(ctx.windows),
    platform,
    settings,
    captures,
    captureScreen,
    fs: nodeStudioFs,
    saveNew,
    logger,
  });
  const pins = new PinManager({
    windows: createPinWindows(ctx.windows),
    captures,
    platform,
    saveImage: saveNew,
    newId: randomUUID,
    logger,
  });
  const actions = new StudioActions({
    session: controller,
    platform,
    fs: nodeStudioFs,
    settings,
    saveNew,
    picturesDir: ctx.paths.picturesDir,
    share: createShareActions({
      runner: createPowerShellRunner({
        exec: defaultExecFile,
        powershellPath: systemPaths.powershell,
        scriptsDir: win32.join(ctx.paths.resourcesDir, 'scripts'),
        platform: process.platform,
        logger,
      }),
      spawnDetached: defaultSpawnDetached,
      paths: systemPaths,
      platform: process.platform,
      logger,
    }),
    wallpaper: createWallpaperApi({
      directory: join(ctx.paths.userData, 'wallpaper'),
      fs: nodeStudioFs,
      logger,
    }),
    pins,
    assist: createAssist({ ocr, logger }),
    logger,
  });
  registerStudioHandlers({ router, controller, actions, pins, hideWindow: hideWindowOf });

  return {
    capture: (source) => controller.capture(source),
    openFile: (shot, source) => controller.openFile(shot, source),
    openImage: (png, size, source) => controller.openImage(png, size, source),
    dispose() {
      pins.closeAll();
      controller.dispose();
    },
  };
}

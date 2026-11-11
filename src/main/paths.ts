import { join } from 'node:path';
import { app } from 'electron';

export interface AppPaths {
  appRoot: string;
  /** Bundled renderer pages (out/renderer). */
  rendererRoot: string;
  /** Preload bundles (out/preload). */
  preloadDir: string;
  /** Icons shipped with the app. */
  assetsDir: string;
  /** Extra files next to the exe in packaged builds (PowerShell helpers, OCR data). */
  resourcesDir: string;
  userData: string;
  logsDir: string;
  modelsDir: string;
  picturesDir: string;
  tempDir: string;
}

/**
 * Must run before `app.whenReady()`. Gives the app a stable, explicit userData folder so dev,
 * packaged and portable builds share settings, and lets E2E tests redirect it.
 */
export function configureUserData(): void {
  const override = process.env['BEEKEEPER_USER_DATA'];
  app.setPath('userData', override ? override : join(app.getPath('appData'), 'Beekeeper'));
}

export function resolveAppPaths(mainDir: string): AppPaths {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  return {
    appRoot,
    rendererRoot: join(mainDir, '..', 'renderer'),
    preloadDir: join(mainDir, '..', 'preload'),
    assetsDir: join(appRoot, 'assets'),
    resourcesDir: app.isPackaged ? process.resourcesPath : join(appRoot, 'resources'),
    userData,
    logsDir: join(userData, 'logs'),
    modelsDir: join(userData, 'models'),
    picturesDir: join(app.getPath('pictures'), 'Beekeeper'),
    tempDir: app.getPath('temp'),
  };
}

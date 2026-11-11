import { win32 } from 'node:path';
import type { Logger } from '@shared/logger';
import {
  assertWindows,
  toSystemError,
  type SpawnDetachedFn,
  type SystemPaths,
} from '../system/exec';
import type { PowerShellRunner } from '../system/powershell';
import { SystemError } from '../system/types';

/** Subject of the e-mail the "Email…" share target opens; the screenshot itself is pasted in. */
export const MAIL_URL = 'mailto:?subject=Screenshot';

export interface ShareActions {
  /** Puts the file on the clipboard as a file drop, so it can be pasted into Explorer, mail or chat. */
  copyFile(path: string): Promise<void>;
  /** Shows Windows' "How do you want to open this file?" dialog for the file. */
  openWith(path: string): Promise<void>;
}

export interface ShareDeps {
  runner: PowerShellRunner;
  spawnDetached: SpawnDetachedFn;
  paths: Pick<SystemPaths, 'rundll32'>;
  platform: NodeJS.Platform;
  logger: Logger;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function assertFilePath(path: string): void {
  if (!win32.isAbsolute(path) || CONTROL_CHARS.test(path)) {
    throw new SystemError('invalid-argument', 'That is not a file path.');
  }
}

/** Share targets that need Windows: the file goes to PowerShell / rundll32 as an argument, never in a command line. */
export function createShareActions(deps: ShareDeps): ShareActions {
  const { runner, spawnDetached, paths, platform, logger } = deps;
  return {
    async copyFile(path) {
      assertFilePath(path);
      await runner.run('clipboard-file', { Path: path });
    },
    async openWith(path) {
      assertWindows(platform);
      assertFilePath(path);
      try {
        await spawnDetached(paths.rundll32, ['shell32.dll,OpenAs_RunDLL', path]);
      } catch (error) {
        const failure = toSystemError(error, 'The "Open with" dialog');
        logger.warn('Opening the "Open with" dialog failed', failure);
        throw failure;
      }
    },
  };
}

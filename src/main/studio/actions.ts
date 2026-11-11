import { win32 } from 'node:path';
import type { Size } from '@shared/geometry';
import type { Logger } from '@shared/logger';
import type {
  StudioActionResult,
  StudioAssistResult,
  StudioAssistTask,
  StudioShareTarget,
} from '@shared/ipc/types';
import { buildBingSearchUrl } from '@shared/webLinks';
import { SystemError } from '../system/types';
import type { WallpaperApi } from '../system/wallpaper';
import type { Assist } from './assist';
import { isPngPath, saveFolders, screenshotFileName, type StudioFs } from './files';
import type { PinManager } from './pins';
import { readPngSize } from './png';
import type { StudioPlatform } from './platform';
import {
  StudioError,
  type SessionAccess,
  type SessionRecord,
  type StudioSettings,
} from './session';
import { MAIL_URL, type ShareActions } from './share';

export interface StudioActionsDeps {
  session: SessionAccess;
  platform: Pick<
    StudioPlatform,
    | 'writeClipboardImage'
    | 'writeClipboardText'
    | 'showSaveDialog'
    | 'trashItem'
    | 'revealInFolder'
    | 'openFolder'
    | 'openExternal'
  >;
  fs: Pick<StudioFs, 'mkdir' | 'overwriteFile' | 'exists'>;
  settings: () => StudioSettings;
  /** Writes a PNG into the screenshots folder with a free "Beekeeper <date> <time>.png" name. */
  saveNew: (png: Buffer) => Promise<string>;
  picturesDir: string;
  share: ShareActions;
  wallpaper: WallpaperApi;
  pins: Pick<PinManager, 'create'>;
  assist: Assist;
  logger: Logger;
  now?: () => Date;
}

/** The image an action works on: the edited PNG the page sent, or the captured one. */
interface ImageInput {
  record: SessionRecord;
  png: Buffer;
  size: Size;
  edited: boolean;
}

function friendly(error: unknown, fallback: string): string {
  return error instanceof StudioError || error instanceof SystemError ? error.message : fallback;
}

/**
 * What the Studio buttons do. Every action works only on the open session; images that come from
 * the page are validated first and paths never do: files are the ones the session created.
 */
export class StudioActions {
  constructor(private readonly deps: StudioActionsDeps) {}

  copy(sessionId: string, png?: Uint8Array): Promise<StudioActionResult> {
    return this.guard('Copying the screenshot', 'Could not copy the screenshot.', async () => {
      const input = this.image(sessionId, png);
      await this.deps.platform.writeClipboardImage(input.png);
      return { ok: true, message: 'Copied to clipboard' };
    });
  }

  save(sessionId: string, png?: Uint8Array, saveAs = false): Promise<StudioActionResult> {
    return this.guard('Saving the screenshot', 'Could not save the screenshot.', async () => {
      const input = this.image(sessionId, png);
      if (saveAs) return await this.saveAs(input);
      return { ok: true, path: await this.persist(input), message: 'Saved' };
    });
  }

  pin(sessionId: string, png?: Uint8Array): Promise<StudioActionResult> {
    return this.guard('Pinning the screenshot', 'Could not pin the screenshot.', () => {
      const input = this.image(sessionId, png);
      this.deps.pins.create(input.png, input.size, input.record.display);
      return Promise.resolve({ ok: true, message: 'Pinned to your screen' });
    });
  }

  wallpaper(sessionId: string, png?: Uint8Array): Promise<StudioActionResult> {
    return this.guard('Setting the wallpaper', 'Could not set the wallpaper.', async () => {
      const input = this.image(sessionId, png);
      await this.deps.wallpaper.setFromPng(input.png);
      return { ok: true, message: 'Wallpaper updated' };
    });
  }

  share(
    sessionId: string,
    target: StudioShareTarget,
    png?: Uint8Array,
  ): Promise<StudioActionResult> {
    return this.guard('Sharing the screenshot', 'Could not share the screenshot.', async () => {
      const input = this.image(sessionId, png);
      // Every target works on a real file: sharing an edit saves it first.
      const path = await this.persist(input);
      switch (target) {
        case 'reveal':
          this.deps.platform.revealInFolder(path);
          return { ok: true, path };
        case 'file':
          await this.deps.share.copyFile(path);
          return { ok: true, path, message: 'Copied as a file' };
        case 'openWith':
          await this.deps.share.openWith(path);
          return { ok: true, path };
        case 'mail':
          await this.deps.share.copyFile(path);
          try {
            await this.deps.platform.openExternal(MAIL_URL);
          } catch (error) {
            this.deps.logger.warn('No mail app could be opened', error);
            return {
              ok: false,
              path,
              message:
                'No e-mail app could be opened. The screenshot is copied: paste it where you need it.',
            };
          }
          return { ok: true, path, message: 'Screenshot copied. Paste it into your e-mail.' };
      }
    });
  }

  async assist(
    sessionId: string,
    task: StudioAssistTask,
    png?: Uint8Array,
  ): Promise<StudioAssistResult> {
    let input: ImageInput;
    try {
      input = this.image(sessionId, png);
    } catch (error) {
      return { ok: false, task, message: friendly(error, 'This screenshot cannot be read.') };
    }
    return this.deps.assist.run(task, input.png, input.size);
  }

  /** Moves the files this session saved to the Recycle Bin. */
  delete(sessionId: string): Promise<StudioActionResult> {
    return this.guard(
      'Deleting the screenshot',
      'Could not move the screenshot to the Recycle Bin.',
      async () => {
        const record = this.deps.session.require(sessionId);
        this.deps.session.activity();
        const paths = [record.originalPath, record.editedPath].filter(
          (path): path is string => path !== null && isPngPath(path),
        );
        if (paths.length === 0) {
          return {
            ok: false,
            message: 'This screenshot was not saved, so there is nothing to delete.',
          };
        }
        for (const path of paths) {
          if (await this.deps.fs.exists(path)) await this.deps.platform.trashItem(path);
        }
        record.originalPath = null;
        record.editedPath = null;
        return { ok: true, message: 'Moved to the Recycle Bin' };
      },
    );
  }

  /** Opens the screenshots folder in Explorer. */
  async openFolder(): Promise<boolean> {
    const { capture } = this.deps.settings();
    for (const folder of saveFolders(capture.saveFolder, this.deps.picturesDir)) {
      try {
        await this.deps.fs.mkdir(folder);
        if (await this.deps.platform.openFolder(folder)) return true;
      } catch (error) {
        this.deps.logger.warn('Opening the screenshots folder failed', error);
      }
    }
    return false;
  }

  copyText(text: string): Promise<StudioActionResult> {
    return this.guard('Copying the text', 'Could not copy the text.', async () => {
      this.deps.session.activity();
      await this.deps.platform.writeClipboardText(text);
      return { ok: true, message: 'Text copied' };
    });
  }

  searchText(text: string): Promise<StudioActionResult> {
    return this.guard('Searching the web', 'Could not open the browser.', async () => {
      this.deps.session.activity();
      await this.deps.platform.openExternal(buildBingSearchUrl(text));
      return { ok: true };
    });
  }

  // ---- helpers ------------------------------------------------------------------------------------

  private image(sessionId: string, png?: Uint8Array): ImageInput {
    const record = this.deps.session.require(sessionId);
    this.deps.session.activity();
    if (!png) {
      return {
        record,
        png: record.png,
        size: { width: record.width, height: record.height },
        edited: false,
      };
    }
    const size = readPngSize(png);
    if (!size) throw new StudioError('That image could not be used.');
    return {
      record,
      png: Buffer.from(png.buffer, png.byteOffset, png.byteLength),
      size,
      edited: true,
    };
  }

  /** Writes the image to disk (once per version) and returns the file's path. */
  private async persist(input: ImageInput): Promise<string> {
    const { record } = input;
    if (!input.edited) {
      const existing = record.originalPath;
      if (existing) return existing;
      const created = await this.deps.saveNew(input.png);
      record.originalPath = created;
      return created;
    }
    // The edit gets its own file, so the unedited capture is never overwritten.
    if (record.editedPath) {
      await this.deps.fs.overwriteFile(record.editedPath, input.png);
      return record.editedPath;
    }
    const created = await this.deps.saveNew(input.png);
    record.editedPath = created;
    return created;
  }

  private async saveAs(input: ImageInput): Promise<StudioActionResult> {
    const { capture } = this.deps.settings();
    const current = input.edited ? input.record.editedPath : input.record.originalPath;
    const suggestion =
      current ??
      win32.join(
        saveFolders(capture.saveFolder, this.deps.picturesDir)[0] ?? this.deps.picturesDir,
        screenshotFileName((this.deps.now ?? (() => new Date()))()),
      );
    const chosen = await this.deps.platform.showSaveDialog(suggestion);
    if (!chosen) return { ok: false };
    if (!isPngPath(chosen)) throw new StudioError('Pick a file name that ends with .png.');
    await this.deps.fs.overwriteFile(chosen, input.png);
    return { ok: true, path: chosen, message: 'Saved' };
  }

  private async guard(
    what: string,
    fallback: string,
    run: () => Promise<StudioActionResult>,
  ): Promise<StudioActionResult> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof StudioError)) this.deps.logger.warn(`${what} failed`, error);
      return { ok: false, message: friendly(error, fallback) };
    }
  }
}

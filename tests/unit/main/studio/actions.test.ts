import { describe, expect, it, vi } from 'vitest';
import type { Size } from '@shared/geometry';
import type { StudioAssistResult } from '@shared/ipc/types';
import { StudioActions } from '@main/studio/actions';
import { createAssist } from '@main/studio/assist';
import { saveFolders, writeNewScreenshot } from '@main/studio/files';
import { MAIL_URL, type ShareActions } from '@main/studio/share';
import { StudioError, type SessionAccess, type SessionRecord } from '@main/studio/session';
import { SystemError } from '@main/system/types';
import {
  createFakePlatform,
  createLogger,
  createMemoryFs,
  DISPLAY,
  makePng,
  PICTURES,
  studioSettings,
} from './support';

const ORIGINAL = `${PICTURES}\\Beekeeper 2026-11-11 13.45.12.png`;
const NOW = new Date(2026, 10, 11, 13, 45, 12);

function setup(
  options: { originalPath?: string | null; settings?: ReturnType<typeof studioSettings> } = {},
) {
  const platform = createFakePlatform();
  const fs = createMemoryFs();
  const png = makePng(1920, 1080);
  const record: SessionRecord = {
    id: 'session-1',
    png,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    source: 'hotkey',
    createdAt: NOW.getTime(),
    display: DISPLAY,
    originalPath: options.originalPath === undefined ? ORIGINAL : options.originalPath,
    editedPath: null,
    published: true,
  };
  if (record.originalPath) fs.files.set(record.originalPath.toLowerCase(), png);
  const settings = options.settings ?? studioSettings();
  const activity = vi.fn();
  const session: SessionAccess = {
    require: (id) => {
      if (id !== record.id) throw new StudioError('This screenshot is no longer open.');
      return record;
    },
    activity,
  };
  const share = {
    copyFile: vi.fn((_path: string) => Promise.resolve()),
    openWith: vi.fn((_path: string) => Promise.resolve()),
  } satisfies ShareActions;
  const wallpaper = { setFromPng: vi.fn((_png: Uint8Array) => Promise.resolve('C:\\w.png')) };
  const pins = { create: vi.fn() };
  const assist = {
    run: vi.fn(
      (task: 'text' | 'sensitive', _png: Buffer, _size: Size): Promise<StudioAssistResult> =>
        Promise.resolve({ ok: true, task }),
    ),
    cancel: vi.fn(),
  };
  const logger = createLogger();
  const actions = new StudioActions({
    session,
    platform,
    fs,
    settings: () => settings,
    saveNew: (data) =>
      writeNewScreenshot(fs, saveFolders(settings.capture.saveFolder, PICTURES), data, NOW),
    picturesDir: PICTURES,
    share,
    wallpaper,
    pins,
    assist,
    logger,
    now: () => NOW,
  });
  return { actions, platform, fs, record, png, share, wallpaper, pins, assist, logger, activity };
}

const EDITED = makePng(800, 600);

describe('which screenshot an action works on', () => {
  it('refuses a session that is not open and does nothing', async () => {
    const { actions, platform } = setup();
    await expect(actions.copy('session-9')).resolves.toEqual({
      ok: false,
      message: 'This screenshot is no longer open.',
    });
    expect(platform.writeClipboardImage).not.toHaveBeenCalled();
  });

  it('refuses an image from the page that is not a PNG', async () => {
    const { actions, platform, fs } = setup();
    const result = await actions.copy('session-1', Buffer.from('<script>alert(1)</script>'));
    expect(result).toEqual({ ok: false, message: 'That image could not be used.' });
    expect(platform.writeClipboardImage).not.toHaveBeenCalled();
    expect(fs.files.size).toBe(1);
  });

  it('counts every action as activity', async () => {
    const { actions, activity } = setup();
    await actions.copy('session-1');
    await actions.copyText('hello');
    expect(activity).toHaveBeenCalledTimes(2);
  });
});

describe('copy', () => {
  it('copies the capture', async () => {
    const { actions, platform, png } = setup();
    expect(await actions.copy('session-1')).toEqual({ ok: true, message: 'Copied to clipboard' });
    expect(platform.writeClipboardImage).toHaveBeenCalledWith(png);
  });

  it('copies the edited image when the page sends one', async () => {
    const { actions, platform } = setup();
    await actions.copy('session-1', EDITED);
    expect(platform.writeClipboardImage.mock.calls[0]?.[0]).toEqual(EDITED);
  });

  it('answers with a friendly message when the clipboard fails, and logs it', async () => {
    const { actions, platform, logger } = setup();
    platform.writeClipboardImage.mockRejectedValueOnce(new Error('clipboard busy'));
    expect(await actions.copy('session-1')).toEqual({
      ok: false,
      message: 'Could not copy the screenshot.',
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('save', () => {
  it('reports the file that already exists instead of writing a second one', async () => {
    const { actions, fs } = setup();
    expect(await actions.save('session-1')).toEqual({ ok: true, path: ORIGINAL, message: 'Saved' });
    expect(fs.files.size).toBe(1);
  });

  it('saves a capture that was not saved yet into the screenshots folder', async () => {
    const { actions, fs, record } = setup({ originalPath: null });
    const result = await actions.save('session-1');
    expect(result.path).toBe(ORIGINAL);
    expect(record.originalPath).toBe(ORIGINAL);
    expect(fs.files.size).toBe(1);
  });

  it('saves an edit as a file of its own and keeps the original', async () => {
    const { actions, fs, record } = setup();
    const result = await actions.save('session-1', EDITED);
    expect(result.path).toBe(`${PICTURES}\\Beekeeper 2026-11-11 13.45.12 (2).png`);
    expect(record.editedPath).toBe(result.path);
    expect(fs.files.get(ORIGINAL.toLowerCase())).toEqual(record.png);
    expect(fs.files.get((result.path ?? '').toLowerCase())).toEqual(EDITED);
  });

  it('overwrites its own edited file when the edit is saved again', async () => {
    const { actions, fs } = setup();
    const first = await actions.save('session-1', EDITED);
    const newer = makePng(640, 480);
    const second = await actions.save('session-1', newer);
    expect(second.path).toBe(first.path);
    expect(fs.files.size).toBe(2);
    expect(fs.files.get((second.path ?? '').toLowerCase())).toEqual(newer);
  });

  it('explains a failure to write', async () => {
    const { actions, fs } = setup({ originalPath: null });
    fs.unwritable.add(PICTURES.toLowerCase());
    expect(await actions.save('session-1')).toEqual({
      ok: false,
      message: 'Could not save the screenshot.',
    });
  });
});

describe('save as', () => {
  it('writes where the user chose, with the dialog starting at the saved file', async () => {
    const { actions, platform, fs, png } = setup();
    platform.showSaveDialog.mockResolvedValueOnce('D:\\Work\\Mine.png');
    expect(await actions.save('session-1', undefined, true)).toEqual({
      ok: true,
      path: 'D:\\Work\\Mine.png',
      message: 'Saved',
    });
    expect(platform.showSaveDialog).toHaveBeenCalledWith(ORIGINAL);
    expect(fs.files.get('d:\\work\\mine.png')).toEqual(png);
  });

  it('starts in the screenshots folder with a fresh name when nothing was saved yet', async () => {
    const { actions, platform } = setup({
      originalPath: null,
      settings: studioSettings({ saveFolder: 'D:\\Shots' }),
    });
    await actions.save('session-1', undefined, true);
    expect(platform.showSaveDialog).toHaveBeenCalledWith(
      'D:\\Shots\\Beekeeper 2026-11-11 13.45.12.png',
    );
  });

  it('saves the edited image when there is one', async () => {
    const { actions, platform, fs } = setup();
    platform.showSaveDialog.mockResolvedValueOnce('D:\\Edited.png');
    await actions.save('session-1', EDITED, true);
    expect(fs.files.get('d:\\edited.png')).toEqual(EDITED);
  });

  it('does nothing, and says nothing, when the dialog is cancelled', async () => {
    const { actions, fs } = setup();
    expect(await actions.save('session-1', undefined, true)).toEqual({ ok: false });
    expect(fs.files.size).toBe(1);
  });

  it('refuses a file name that is not a PNG', async () => {
    const { actions, platform, fs } = setup();
    platform.showSaveDialog.mockResolvedValueOnce('D:\\Work\\run.exe');
    expect(await actions.save('session-1', undefined, true)).toEqual({
      ok: false,
      message: 'Pick a file name that ends with .png.',
    });
    expect(fs.files.has('d:\\work\\run.exe')).toBe(false);
  });
});

describe('pin and wallpaper', () => {
  it('pins the capture on the display it came from', async () => {
    const { actions, pins, png } = setup();
    expect(await actions.pin('session-1')).toEqual({ ok: true, message: 'Pinned to your screen' });
    expect(pins.create).toHaveBeenCalledWith(png, { width: 1920, height: 1080 }, DISPLAY);
  });

  it('pins the edited image with its own size', async () => {
    const { actions, pins } = setup();
    await actions.pin('session-1', EDITED);
    expect(pins.create.mock.calls[0]?.[1]).toEqual({ width: 800, height: 600 });
  });

  it('sets the wallpaper', async () => {
    const { actions, wallpaper, png } = setup();
    expect(await actions.wallpaper('session-1')).toEqual({
      ok: true,
      message: 'Wallpaper updated',
    });
    expect(wallpaper.setFromPng).toHaveBeenCalledWith(png);
  });

  it('passes on the wallpaper error message when it is one Beekeeper wrote for the user', async () => {
    const { actions, wallpaper } = setup();
    wallpaper.setFromPng.mockRejectedValueOnce(
      new SystemError('failed', 'Windows did not let Beekeeper change the wallpaper.'),
    );
    expect(await actions.wallpaper('session-1')).toEqual({
      ok: false,
      message: 'Windows did not let Beekeeper change the wallpaper.',
    });
  });

  it('uses a generic message for an unexpected wallpaper error', async () => {
    const { actions, wallpaper } = setup();
    wallpaper.setFromPng.mockRejectedValueOnce(new Error('EPERM: C:\\secret\\path'));
    expect(await actions.wallpaper('session-1')).toEqual({
      ok: false,
      message: 'Could not set the wallpaper.',
    });
  });
});

describe('share', () => {
  it('copies the saved file to the clipboard as a file', async () => {
    const { actions, share } = setup();
    expect(await actions.share('session-1', 'file')).toEqual({
      ok: true,
      path: ORIGINAL,
      message: 'Copied as a file',
    });
    expect(share.copyFile).toHaveBeenCalledWith(ORIGINAL);
  });

  it('saves an unsaved capture first, because every target needs a file', async () => {
    const { actions, share, fs } = setup({ originalPath: null });
    await actions.share('session-1', 'file');
    expect(fs.files.size).toBe(1);
    expect(share.copyFile).toHaveBeenCalledWith(ORIGINAL);
  });

  it('shares an edit through its own saved file', async () => {
    const { actions, share } = setup();
    await actions.share('session-1', 'file', EDITED);
    expect(share.copyFile).toHaveBeenCalledWith(
      `${PICTURES}\\Beekeeper 2026-11-11 13.45.12 (2).png`,
    );
  });

  it('reveals the file in Explorer', async () => {
    const { actions, platform } = setup();
    expect(await actions.share('session-1', 'reveal')).toEqual({ ok: true, path: ORIGINAL });
    expect(platform.revealInFolder).toHaveBeenCalledWith(ORIGINAL);
  });

  it('opens the "Open with" dialog', async () => {
    const { actions, share } = setup();
    expect(await actions.share('session-1', 'openWith')).toEqual({ ok: true, path: ORIGINAL });
    expect(share.openWith).toHaveBeenCalledWith(ORIGINAL);
  });

  it('puts the file on the clipboard and opens an e-mail with a fixed subject', async () => {
    const { actions, share, platform } = setup();
    expect(await actions.share('session-1', 'mail')).toEqual({
      ok: true,
      path: ORIGINAL,
      message: 'Screenshot copied. Paste it into your e-mail.',
    });
    expect(share.copyFile).toHaveBeenCalledWith(ORIGINAL);
    expect(platform.openExternal).toHaveBeenCalledWith(MAIL_URL);
  });

  it('says so when no e-mail app opens, while the file is on the clipboard', async () => {
    const { actions, platform } = setup();
    platform.openExternal.mockRejectedValueOnce(new Error('no handler'));
    const result = await actions.share('session-1', 'mail');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('paste it where you need it');
  });

  it('passes on errors the system layer wrote for the user', async () => {
    const { actions, share } = setup();
    share.copyFile.mockRejectedValueOnce(
      new SystemError('failed', 'The screenshot file does not exist.'),
    );
    expect(await actions.share('session-1', 'file')).toEqual({
      ok: false,
      message: 'The screenshot file does not exist.',
    });
  });
});

describe('Photo assist', () => {
  it('runs the task on the capture or on the edited image', async () => {
    const { actions, assist, png } = setup();
    await actions.assist('session-1', 'text');
    expect(assist.run).toHaveBeenCalledWith('text', png, { width: 1920, height: 1080 });
    await actions.assist('session-1', 'sensitive', EDITED);
    expect(assist.run.mock.calls[1]?.[0]).toBe('sensitive');
    expect(assist.run.mock.calls[1]?.[2]).toEqual({ width: 800, height: 600 });
  });

  it('answers with a failed result for a session that is not open', async () => {
    const { actions, assist } = setup();
    expect(await actions.assist('session-9', 'text')).toEqual({
      ok: false,
      task: 'text',
      message: 'This screenshot is no longer open.',
    });
    expect(assist.run).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('moves the capture to the Recycle Bin and forgets the path', async () => {
    const { actions, platform, record } = setup();
    expect(await actions.delete('session-1')).toEqual({
      ok: true,
      message: 'Moved to the Recycle Bin',
    });
    expect(platform.trashItem).toHaveBeenCalledWith(ORIGINAL);
    expect(record.originalPath).toBeNull();
  });

  it('also removes the edited version', async () => {
    const { actions, platform, record } = setup();
    await actions.save('session-1', EDITED);
    await actions.delete('session-1');
    expect(platform.trashItem).toHaveBeenCalledTimes(2);
    expect(record.editedPath).toBeNull();
  });

  it('says there is nothing to delete when nothing was saved', async () => {
    const { actions, platform } = setup({ originalPath: null });
    const result = await actions.delete('session-1');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('nothing to delete');
    expect(platform.trashItem).not.toHaveBeenCalled();
  });

  it('skips a file that is already gone', async () => {
    const { actions, platform, fs } = setup();
    fs.files.delete(ORIGINAL.toLowerCase());
    expect((await actions.delete('session-1')).ok).toBe(true);
    expect(platform.trashItem).not.toHaveBeenCalled();
  });

  it('never trashes a path that is not a PNG', async () => {
    const { actions, platform, record } = setup({ originalPath: 'C:\\Windows\\System32\\cmd.exe' });
    expect((await actions.delete('session-1')).ok).toBe(false);
    expect(platform.trashItem).not.toHaveBeenCalled();
    expect(record.originalPath).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('explains a failure and keeps the path', async () => {
    const { actions, platform, record } = setup();
    platform.trashItem.mockRejectedValueOnce(new Error('in use'));
    expect(await actions.delete('session-1')).toEqual({
      ok: false,
      message: 'Could not move the screenshot to the Recycle Bin.',
    });
    expect(record.originalPath).toBe(ORIGINAL);
  });
});

describe('folder and text', () => {
  it('opens the screenshots folder', async () => {
    const { actions, platform, fs } = setup({
      settings: studioSettings({ saveFolder: 'D:\\Shots' }),
    });
    expect(await actions.openFolder()).toBe(true);
    expect(platform.openFolder).toHaveBeenCalledWith('D:\\Shots');
    expect(fs.folders.has('d:\\shots')).toBe(true);
  });

  it('falls back to Pictures\\Beekeeper when the configured folder cannot be opened', async () => {
    const { actions, platform } = setup({ settings: studioSettings({ saveFolder: 'D:\\Shots' }) });
    platform.openFolder.mockResolvedValueOnce(false);
    expect(await actions.openFolder()).toBe(true);
    expect(platform.openFolder).toHaveBeenLastCalledWith(PICTURES);
  });

  it('gives up when Explorer cannot open anything', async () => {
    const { actions, platform } = setup();
    platform.openFolder.mockResolvedValue(false);
    expect(await actions.openFolder()).toBe(false);
  });

  it('survives a folder that cannot be created', async () => {
    const { actions, fs, logger } = setup();
    fs.unwritable.add(PICTURES.toLowerCase());
    expect(await actions.openFolder()).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('copies text', async () => {
    const { actions, platform } = setup();
    expect(await actions.copyText('hello')).toEqual({ ok: true, message: 'Text copied' });
    expect(platform.writeClipboardText).toHaveBeenCalledWith('hello');
  });

  it('searches the web with the text encoded in the link', async () => {
    const { actions, platform } = setup();
    expect(await actions.searchText('red & blue?')).toEqual({ ok: true });
    expect(platform.openExternal).toHaveBeenCalledWith(
      'https://www.bing.com/search?q=red%20%26%20blue%3F',
    );
  });

  it('explains when the browser cannot be opened', async () => {
    const { actions, platform } = setup();
    platform.openExternal.mockRejectedValueOnce(new Error('no browser'));
    expect(await actions.searchText('x')).toEqual({
      ok: false,
      message: 'Could not open the browser.',
    });
  });
});

describe('createAssist', () => {
  const lines = [
    {
      text: 'mail me@example.com',
      confidence: 90,
      bbox: { x: 0, y: 0, width: 190, height: 20 },
      words: [
        { text: 'mail', confidence: 90, bbox: { x: 0, y: 0, width: 40, height: 20 }, lineIndex: 0 },
        {
          text: 'me@example.com',
          confidence: 90,
          bbox: { x: 50, y: 0, width: 140, height: 20 },
          lineIndex: 0,
        },
      ],
    },
  ];

  function assistSetup(recognize: (...args: unknown[]) => Promise<unknown>) {
    const ocr = {
      warmUp: vi.fn(() => Promise.resolve()),
      recognize: vi.fn(recognize),
    };
    const logger = createLogger();
    return { ocr, logger, assist: createAssist({ ocr: ocr as never, logger }) };
  }

  const size = { width: 400, height: 100 };
  const png = makePng(400, 100);

  it('warms the engine up and returns the trimmed text', async () => {
    const { assist, ocr } = assistSetup(() =>
      Promise.resolve({ text: '  Hello world \n', lines: [], words: [] }),
    );
    expect(await assist.run('text', png, size)).toEqual({
      ok: true,
      task: 'text',
      text: 'Hello world',
    });
    expect(ocr.warmUp).toHaveBeenCalledBefore(ocr.recognize);
    expect(ocr.recognize.mock.calls[0]?.[1]).toMatchObject({ supersedePending: true });
  });

  it('says so when there is no text', async () => {
    const { assist } = assistSetup(() => Promise.resolve({ text: ' ', lines: [], words: [] }));
    expect(await assist.run('text', png, size)).toEqual({
      ok: true,
      task: 'text',
      text: '',
      message: 'No text found in this screenshot.',
    });
  });

  it('finds the regions to blur', async () => {
    const { assist } = assistSetup(() =>
      Promise.resolve({ text: 'mail me@example.com', lines, words: [] }),
    );
    const result = await assist.run('sensitive', png, size);
    expect(result.ok).toBe(true);
    expect(result.regions).toEqual([
      { kind: 'email', label: 'Email address', rect: { x: 46, y: 0, width: 148, height: 24 } },
    ]);
  });

  it('says so when nothing sensitive is found', async () => {
    const { assist } = assistSetup(() => Promise.resolve({ text: 'hello', lines: [], words: [] }));
    expect(await assist.run('sensitive', png, size)).toEqual({
      ok: true,
      task: 'sensitive',
      regions: [],
      message: 'No sensitive info found.',
    });
  });

  it.each([
    ['assets-missing', 'Text recognition is not available in this build.'],
    ['timeout', 'Reading the screenshot took too long. Try again.'],
    ['invalid-image', 'This image cannot be read.'],
    ['failed', 'The text could not be read. Try again.'],
  ])('turns the OCR error %s into a friendly message', async (code, message) => {
    const { assist, logger } = assistSetup(() =>
      Promise.reject(Object.assign(new Error('x'), { code })),
    );
    expect(await assist.run('text', png, size)).toEqual({ ok: false, task: 'text', message });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not log a request that was replaced by a newer one', async () => {
    const { assist, logger } = assistSetup(() =>
      Promise.reject(Object.assign(new Error('x'), { code: 'superseded' })),
    );
    expect(await assist.run('text', png, size)).toEqual({
      ok: false,
      task: 'text',
      message: 'Cancelled.',
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('cancels the previous request when a new one starts, and on cancel()', async () => {
    const signals: AbortSignal[] = [];
    const { assist } = assistSetup((_image, options) => {
      signals.push((options as { signal: AbortSignal }).signal);
      return new Promise(() => undefined);
    });
    void assist.run('text', png, size);
    await Promise.resolve();
    await Promise.resolve();
    void assist.run('text', png, size);
    await Promise.resolve();
    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    assist.cancel();
    expect(signals[1]?.aborted).toBe(true);
  });

  it('carries on when warming up fails', async () => {
    const { assist, ocr } = assistSetup(() =>
      Promise.resolve({ text: 'ok', lines: [], words: [] }),
    );
    ocr.warmUp.mockRejectedValueOnce(new Error('warm-up failed'));
    expect((await assist.run('text', png, size)).text).toBe('ok');
  });
});

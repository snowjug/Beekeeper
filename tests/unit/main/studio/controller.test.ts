import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureStore } from '@main/capture/store';
import { StudioController, shortPath } from '@main/studio/controller';
import { saveFolders, writeNewScreenshot } from '@main/studio/files';
import type { StudioSettings } from '@main/studio/session';
import {
  createFakePlatform,
  createFakeWindows,
  createLogger,
  createMemoryFs,
  DISPLAY,
  makePng,
  PICTURES,
  studioSettings,
} from './support';

const SHOT = makePng(1920, 1080);
const NOW = new Date(2026, 10, 11, 13, 45, 12);
const FILE = `${PICTURES}\\Beekeeper 2026-11-11 13.45.12.png`;

function setup(settings: StudioSettings = studioSettings()) {
  const state = { settings };
  const windows = createFakeWindows();
  const platform = createFakePlatform();
  const fs = createMemoryFs();
  const captures = new CaptureStore();
  const logger = createLogger();
  const captureScreen = vi.fn(() => Promise.resolve({ png: SHOT, width: 1920, height: 1080 }));
  let counter = 0;
  const controller = new StudioController({
    windows,
    platform,
    settings: () => state.settings,
    captures,
    captureScreen,
    fs,
    saveNew: (png) =>
      writeNewScreenshot(fs, saveFolders(state.settings.capture.saveFolder, PICTURES), png, NOW),
    logger,
    newId: () => `session-${(counter += 1)}`,
    now: () => NOW.getTime(),
    idleDestroyMs: 10_000,
  });
  // The page decodes the image as soon as it receives the session.
  windows.onSession = (session) => {
    queueMicrotask(() => controller.markReady(session.id));
  };
  return { state, windows, platform, fs, captures, logger, captureScreen, controller };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('capture', () => {
  it('creates nothing until a capture is made', () => {
    const { windows, captureScreen } = setup();
    expect(windows.created).toHaveLength(0);
    expect(captureScreen).not.toHaveBeenCalled();
  });

  it('saves the screenshot, stores it, sends the session and shows the window over the work area', async () => {
    const { controller, windows, fs, captures } = setup(studioSettings({}, true));
    await controller.capture('hotkey');

    expect(fs.files.get(FILE.toLowerCase())).toEqual(SHOT);
    const [session] = windows.sessions;
    expect(session).toEqual({
      id: 'session-1',
      imageUrl: 'beekeeper://app/capture/session-1.png',
      width: 1920,
      height: 1080,
      scaleFactor: 1,
      savedPath: FILE,
      source: 'hotkey',
      createdAt: NOW.getTime(),
      display: { id: 1, bounds: DISPLAY.bounds },
      aiAvailable: true,
      glowFrame: true,
      dismissAfterSeconds: 0,
      theme: 'light',
    });
    expect(captures.get('session-1')).toEqual({ data: SHOT, mime: 'image/png' });
    expect(controller.describeCurrent()).toEqual(session);

    const win = windows.window;
    expect(win?.setBounds).toHaveBeenCalledWith(DISPLAY.workArea);
    expect(win?.raise).toHaveBeenCalled();
    expect(win?.show).toHaveBeenCalledOnce();
    expect(win?.focus).toHaveBeenCalledOnce();
    expect(controller.isOpen).toBe(true);
  });

  it('describes the dark theme and the glow and dismiss settings', async () => {
    const { controller, windows, platform } = setup(
      studioSettings({ glowFrame: false, dismissAfterSeconds: 7 }),
    );
    platform.dark.value = true;
    await controller.capture('tray');
    expect(windows.sessions[0]).toMatchObject({
      theme: 'dark',
      glowFrame: false,
      dismissAfterSeconds: 7,
      source: 'tray',
    });
  });

  it('does not show the window until the page has decoded the image', async () => {
    const { controller, windows } = setup();
    windows.onSession = () => undefined;
    const opening = controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(100);
    expect(windows.window?.show).not.toHaveBeenCalled();
    controller.markReady('session-1');
    await opening;
    expect(windows.window?.show).toHaveBeenCalledOnce();
  });

  it('ignores a ready message for another session', async () => {
    const { controller, windows } = setup();
    windows.onSession = () => undefined;
    const opening = controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(100);
    controller.markReady('other');
    await vi.advanceTimersByTimeAsync(100);
    expect(windows.window?.show).not.toHaveBeenCalled();
    controller.markReady('session-1');
    await opening;
  });

  it('gives up and tells the user when the page never answers', async () => {
    const { controller, windows, platform, logger } = setup();
    windows.onSession = () => undefined;
    const opening = controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(3100);
    await opening;
    expect(windows.window?.show).not.toHaveBeenCalled();
    expect(controller.isOpen).toBe(false);
    expect(controller.current()).toBeNull();
    expect(platform.notices[0]).toMatchObject({ title: 'Capture Studio could not open' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports a failed screenshot and can capture again afterwards', async () => {
    const { controller, windows, platform, captureScreen } = setup();
    captureScreen.mockRejectedValueOnce(new Error('Windows refused'));
    await controller.capture('hotkey');
    expect(platform.notices[0]?.title).toBe('Capture Studio could not open');
    expect(windows.window?.show).not.toHaveBeenCalled();

    await controller.capture('hotkey');
    expect(windows.window?.show).toHaveBeenCalledOnce();
  });

  it('ignores a second capture while the first one is still being taken', async () => {
    const { controller, captureScreen } = setup();
    let finish: (value: { png: Buffer; width: number; height: number }) => void = () => undefined;
    captureScreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = controller.capture('hotkey');
    await controller.capture('hotkey');
    expect(captureScreen).toHaveBeenCalledOnce();
    finish({ png: SHOT, width: 1920, height: 1080 });
    await first;
    expect(controller.isOpen).toBe(true);
  });

  it('starts loading the window while the screen is captured', async () => {
    const { controller, windows, captureScreen } = setup();
    let finish: (value: { png: Buffer; width: number; height: number }) => void = () => undefined;
    captureScreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = controller.capture('hotkey');
    expect(windows.created).toHaveLength(1);
    finish({ png: SHOT, width: 1920, height: 1080 });
    await opening;
  });
});

describe('settings', () => {
  it('does not save when automatic saving is off', async () => {
    const { controller, windows, fs } = setup(studioSettings({ autoSave: false }));
    await controller.capture('hotkey');
    expect(fs.files.size).toBe(0);
    expect(windows.sessions[0]?.savedPath).toBeNull();
  });

  it('copies to the clipboard when automatic copying is on', async () => {
    const { controller, platform } = setup(studioSettings({ autoCopy: true }));
    await controller.capture('hotkey');
    expect(platform.writeClipboardImage).toHaveBeenCalledWith(SHOT);
  });

  it('saves into the configured folder and numbers a second file in the same second', async () => {
    const { controller, fs, state } = setup(studioSettings({ saveFolder: 'D:\\Shots\\' }));
    await controller.capture('hotkey');
    controller.dispose();
    await controller.capture('hotkey');
    expect([...fs.files.keys()].sort()).toEqual([
      'd:\\shots\\beekeeper 2026-11-11 13.45.12 (2).png',
      'd:\\shots\\beekeeper 2026-11-11 13.45.12.png',
    ]);
    expect(state.settings.capture.saveFolder).toBe('D:\\Shots\\');
  });

  it('falls back to Pictures\\Beekeeper when the configured folder cannot be created', async () => {
    const { controller, fs, windows } = setup(studioSettings({ saveFolder: 'Z:\\Missing' }));
    fs.unwritable.add('z:\\missing');
    await controller.capture('hotkey');
    expect(windows.sessions[0]?.savedPath).toBe(FILE);
  });

  it('still opens the preview, and says so, when the file cannot be written', async () => {
    const { controller, fs, windows, platform, logger } = setup();
    fs.unwritable.add(PICTURES.toLowerCase());
    await controller.capture('hotkey');
    expect(windows.sessions[0]?.savedPath).toBeNull();
    expect(windows.window?.show).toHaveBeenCalled();
    expect(platform.notices[0]?.title).toBe('Screenshot not saved');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('survives a failing clipboard', async () => {
    const { controller, platform, windows } = setup(studioSettings({ autoCopy: true }));
    platform.writeClipboardImage.mockRejectedValueOnce(new Error('clipboard busy'));
    await controller.capture('hotkey');
    expect(windows.window?.show).toHaveBeenCalled();
  });
});

describe('without the preview', () => {
  it('saves silently and shows a toast and a notification instead of a window', async () => {
    const { controller, windows, fs, platform } = setup(studioSettings({ openStudio: false }));
    await controller.capture('hotkey');
    expect(windows.created).toHaveLength(0);
    expect(fs.files.has(FILE.toLowerCase())).toBe(true);
    expect(windows.toasts).toEqual([
      { title: 'Screenshot saved', message: shortPath(FILE), tone: 'success' },
    ]);
    expect(platform.notices[0]).toMatchObject({ title: 'Screenshot saved', body: shortPath(FILE) });
    platform.notices[0]?.onClick?.();
    expect(platform.revealInFolder).toHaveBeenCalledWith(FILE);
    expect(controller.isOpen).toBe(false);
  });

  it('shortens a path to its folder and file name', () => {
    expect(shortPath(FILE)).toBe('Beekeeper\\Beekeeper 2026-11-11 13.45.12.png');
  });

  it('still saves when neither saving nor copying is switched on, so the capture is not lost', async () => {
    const { controller, fs } = setup(
      studioSettings({ openStudio: false, autoSave: false, autoCopy: false }),
    );
    await controller.capture('hotkey');
    expect(fs.files.size).toBe(1);
  });

  it('only copies when copying is on and saving is off', async () => {
    const { controller, fs, platform, windows } = setup(
      studioSettings({ openStudio: false, autoSave: false, autoCopy: true }),
    );
    await controller.capture('hotkey');
    expect(fs.files.size).toBe(0);
    expect(platform.writeClipboardImage).toHaveBeenCalledWith(SHOT);
    expect(windows.toasts[0]).toMatchObject({ title: 'Screenshot copied' });
  });

  it('saves and copies when both are on', async () => {
    const { controller, windows } = setup(
      studioSettings({ openStudio: false, autoSave: true, autoCopy: true }),
    );
    await controller.capture('hotkey');
    expect(windows.toasts[0]).toMatchObject({ title: 'Screenshot saved and copied' });
  });

  it('reports a screenshot that could be neither saved nor copied', async () => {
    const { controller, fs, windows, platform } = setup(studioSettings({ openStudio: false }));
    fs.unwritable.add(PICTURES.toLowerCase());
    await controller.capture('hotkey');
    expect(windows.toasts).toHaveLength(0);
    expect(platform.notices[0]?.title).toBe('Screenshot not saved');
  });
});

describe('replacing and closing', () => {
  it('hides the open preview before the next capture and frees its session', async () => {
    const { controller, windows, captures, captureScreen } = setup();
    await controller.capture('hotkey');
    expect(captures.get('session-1')).toBeDefined();
    captureScreen.mockImplementationOnce(() => {
      // The old preview must already be off the screen when the new screenshot is taken.
      expect(windows.window?.visible).toBe(false);
      return Promise.resolve({ png: SHOT, width: 1920, height: 1080 });
    });

    const second = controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(100);
    await second;

    expect(captures.get('session-1')).toBeUndefined();
    expect(captures.get('session-2')).toBeDefined();
    expect(windows.sessions.map((session) => session.id)).toEqual(['session-1', 'session-2']);
    expect(windows.created).toHaveLength(1);
    expect(windows.window?.order).toEqual(['show', 'hide', 'show']);
  });

  it('plays the exit animation when asked to close, then hides the window and frees the session', async () => {
    const { controller, windows, captures } = setup();
    await controller.capture('hotkey');
    controller.requestClose('escape');
    expect(windows.cancels).toEqual(['escape']);
    expect(windows.window?.visible).toBe(true);

    controller.acknowledgeClosed('session-1');
    expect(windows.window?.visible).toBe(false);
    expect(captures.get('session-1')).toBeUndefined();
    expect(controller.describeCurrent()).toBeNull();
    expect(controller.isOpen).toBe(false);
  });

  it('closes anyway when the page never acknowledges the exit animation', async () => {
    const { controller, windows } = setup();
    await controller.capture('hotkey');
    controller.requestClose('api');
    await vi.advanceTimersByTimeAsync(600);
    expect(windows.window?.visible).toBe(false);
    expect(controller.current()).toBeNull();
  });

  it('closes at once when the page closes itself after Esc', async () => {
    const { controller, windows } = setup();
    await controller.capture('hotkey');
    controller.acknowledgeClosed('session-1');
    expect(windows.window?.visible).toBe(false);
    expect(windows.cancels).toEqual([]);
  });

  it('ignores an acknowledgement for a screenshot that is not the open one', async () => {
    const { controller, windows } = setup();
    await controller.capture('hotkey');
    controller.acknowledgeClosed('session-0');
    expect(windows.window?.visible).toBe(true);
    expect(controller.current()?.id).toBe('session-1');
  });

  it('does nothing when asked to close while nothing is open', () => {
    const { controller, windows } = setup();
    controller.requestClose('escape');
    controller.acknowledgeClosed('x');
    expect(windows.cancels).toEqual([]);
  });

  it('closes when a display is removed or changes, and stops listening afterwards', async () => {
    const { controller, windows, platform } = setup();
    await controller.capture('hotkey');
    expect(platform.listenerCount()).toBe(1);
    platform.emitDisplayChange();
    expect(windows.cancels).toEqual(['display-change']);
    controller.acknowledgeClosed('session-1');
    expect(platform.listenerCount()).toBe(0);
  });

  it('does not listen to display changes while nothing is open', () => {
    const { platform } = setup();
    expect(platform.listenerCount()).toBe(0);
  });

  it('forgets the session when its window is closed from outside', async () => {
    const { controller, windows, captures } = setup();
    await controller.capture('hotkey');
    windows.window?.closeFromOutside();
    expect(controller.current()).toBeNull();
    expect(captures.get('session-1')).toBeUndefined();
  });

  it('lets only the open session be used', async () => {
    const { controller } = setup();
    expect(() => controller.require('session-1')).toThrow('no longer open');
    await controller.capture('hotkey');
    expect(controller.require('session-1').id).toBe('session-1');
    expect(() => controller.require('session-9')).toThrow('no longer open');
    controller.acknowledgeClosed('session-1');
    expect(() => controller.require('session-1')).toThrow('no longer open');
  });

  it('closes everything when disposed', async () => {
    const { controller, windows, captures } = setup();
    await controller.capture('hotkey');
    controller.dispose();
    expect(windows.destroy).toHaveBeenCalled();
    expect(captures.size).toBe(0);
    expect(controller.isOpen).toBe(false);
  });
});

describe('the window that asked for the capture', () => {
  /** A window that steps aside: `hide` and `restore` write into one timeline with the capture. */
  function aside() {
    const events: string[] = [];
    const restore = vi.fn((options: { focus: boolean }) => {
      events.push(`restore focus=${String(options.focus)}`);
    });
    const hide = vi.fn(() => {
      events.push('hide');
      return restore;
    });
    return { events, restore, hide };
  }

  it('is hidden, given time to leave the screen, and back only after the picture is taken', async () => {
    const { controller, captureScreen } = setup();
    const { events, hide } = aside();
    captureScreen.mockImplementationOnce(() => {
      events.push('capture');
      return Promise.resolve({ png: SHOT, width: 1920, height: 1080 });
    });

    const capturing = controller.capture('ui', hide);
    expect(events).toEqual(['hide']);
    await vi.advanceTimersByTimeAsync(60);
    expect(events).toEqual(['hide']);
    await vi.advanceTimersByTimeAsync(40);
    await capturing;
    // It returns behind the preview: the preview takes the focus.
    expect(events).toEqual(['hide', 'capture', 'restore focus=false']);
  });

  it('gets the focus back when there is no preview to take it', async () => {
    const { controller, windows } = setup(studioSettings({ openStudio: false }));
    const { events, hide } = aside();
    const capturing = controller.capture('ui', hide);
    await vi.advanceTimersByTimeAsync(100);
    await capturing;
    expect(events).toEqual(['hide', 'restore focus=true']);
    expect(windows.created).toHaveLength(0);
  });

  it('comes back, with the focus, when the screen cannot be captured', async () => {
    const { controller, captureScreen, platform } = setup();
    captureScreen.mockRejectedValueOnce(new Error('the desktop is locked'));
    const { events, hide } = aside();
    const capturing = controller.capture('ui', hide);
    await vi.advanceTimersByTimeAsync(100);
    await capturing;
    expect(events).toEqual(['hide', 'restore focus=true']);
    expect(platform.notices[0]?.title).toBe('Capture Studio could not open');
  });

  it('comes back once when the capture is abandoned half way', async () => {
    const { controller, captureScreen } = setup();
    let release: () => void = () => undefined;
    captureScreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ png: SHOT, width: 1920, height: 1080 });
        }),
    );
    const { events, restore, hide } = aside();
    const capturing = controller.capture('ui', hide);
    await vi.advanceTimersByTimeAsync(100);
    controller.dispose();
    release();
    await capturing;
    expect(restore).toHaveBeenCalledOnce();
    expect(events).toEqual(['hide', 'restore focus=false']);
  });

  it('is left alone when it was not on screen', async () => {
    const { controller, windows } = setup();
    const hide = vi.fn(() => null);
    await controller.capture('ui', hide);
    expect(hide).toHaveBeenCalledOnce();
    expect(windows.window?.show).toHaveBeenCalledOnce();
  });

  it('does not stop the capture when it cannot be hidden or brought back', async () => {
    const { controller, windows, logger } = setup();
    await controller.capture('ui', () => {
      throw new Error('no such window');
    });
    expect(windows.window?.show).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const restore = vi.fn(() => {
      throw new Error('already destroyed');
    });
    const capturing = controller.capture('ui', () => restore);
    await vi.advanceTimersByTimeAsync(100);
    await capturing;
    expect(restore).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(controller.isOpen).toBe(true);
  });

  it('is not hidden while another capture is already running', async () => {
    const { controller, captureScreen } = setup();
    let release: () => void = () => undefined;
    captureScreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ png: SHOT, width: 1920, height: 1080 });
        }),
    );
    const first = controller.capture('hotkey');
    const hide = vi.fn(() => null);
    await controller.capture('ui', hide);
    expect(hide).not.toHaveBeenCalled();
    release();
    await first;
  });
});

describe('window lifetime', () => {
  it('destroys the hidden window after the idle time', async () => {
    const { controller, windows } = setup();
    await controller.capture('hotkey');
    controller.acknowledgeClosed('session-1');
    await vi.advanceTimersByTimeAsync(9_900);
    expect(windows.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(windows.destroy).toHaveBeenCalledOnce();
  });

  it('reuses the window, and keeps it, when the Studio is used again in time', async () => {
    const { controller, windows } = setup();
    await controller.capture('hotkey');
    controller.acknowledgeClosed('session-1');
    await vi.advanceTimersByTimeAsync(5_000);
    await controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(windows.destroy).not.toHaveBeenCalled();
    expect(windows.created).toHaveLength(1);
    expect(windows.sessions).toHaveLength(2);
  });

  it('creates a fresh window after the idle one was destroyed', async () => {
    const { controller, windows } = setup();
    await controller.capture('hotkey');
    controller.acknowledgeClosed('session-1');
    await vi.advanceTimersByTimeAsync(11_000);
    await controller.capture('hotkey');
    expect(windows.created).toHaveLength(2);
    expect(windows.created[1]?.show).toHaveBeenCalled();
  });
});

describe('automatic dismissal', () => {
  it('closes the preview after the configured time without activity', async () => {
    const { controller, windows } = setup(studioSettings({ dismissAfterSeconds: 5 }));
    await controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(4_900);
    expect(windows.cancels).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(windows.cancels).toEqual(['api']);
  });

  it('starts counting again whenever the user is active', async () => {
    const { controller, windows } = setup(studioSettings({ dismissAfterSeconds: 5 }));
    await controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(4_000);
    controller.touch(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(windows.cancels).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(windows.cancels).toEqual(['api']);
  });

  it('waits while the user is busy (editing, a menu is open) and resumes afterwards', async () => {
    const { controller, windows } = setup(studioSettings({ dismissAfterSeconds: 5 }));
    await controller.capture('hotkey');
    controller.touch(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(windows.cancels).toEqual([]);
    controller.touch(false);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(windows.cancels).toEqual(['api']);
  });

  it('counts an action as activity', async () => {
    const { controller, windows } = setup(studioSettings({ dismissAfterSeconds: 5 }));
    await controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(4_000);
    controller.activity();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(windows.cancels).toEqual([]);
  });

  it('never closes by itself when the time is 0', async () => {
    const { controller, windows } = setup(studioSettings({ dismissAfterSeconds: 0 }));
    await controller.capture('hotkey');
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(windows.cancels).toEqual([]);
    expect(windows.window?.visible).toBe(true);
  });

  it('does not close a preview that is already gone', async () => {
    const { controller, windows } = setup(studioSettings({ dismissAfterSeconds: 5 }));
    await controller.capture('hotkey');
    controller.acknowledgeClosed('session-1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(windows.cancels).toEqual([]);
  });
});

describe('opening a saved file', () => {
  const PATH = 'C:\\Users\\tester\\Pictures\\Beekeeper\\Screenshot 2026-11-10 16-20-53.png';

  function withFile(settings?: StudioSettings) {
    const harness = setup(settings);
    harness.fs.files.set(PATH.toLowerCase(), SHOT);
    return harness;
  }

  it('shows the file as it is: it is not saved a second time', async () => {
    const { controller, windows, fs } = withFile();
    await controller.openFile({ path: PATH, width: 1920, height: 1080 });
    expect(fs.files.size).toBe(1);
    expect(windows.sessions[0]).toMatchObject({
      savedPath: PATH,
      source: 'voice',
      width: 1920,
      height: 1080,
    });
    expect(windows.window?.show).toHaveBeenCalled();
  });

  it('takes the size from the file, not from the caller', async () => {
    const { controller, windows } = withFile();
    await controller.openFile({ path: PATH, width: 1, height: 1 }, 'voice');
    expect(windows.sessions[0]).toMatchObject({ width: 1920, height: 1080 });
  });

  it('copies it when automatic copying is on', async () => {
    const { controller, platform } = withFile(studioSettings({ autoCopy: true }));
    await controller.openFile({ path: PATH, width: 1920, height: 1080 });
    expect(platform.writeClipboardImage).toHaveBeenCalledWith(SHOT);
  });

  it('only copies, without a window or a toast, when the preview is off', async () => {
    const { controller, platform, windows } = withFile(
      studioSettings({ openStudio: false, autoCopy: true }),
    );
    await controller.openFile({ path: PATH, width: 1920, height: 1080 });
    expect(windows.created).toHaveLength(0);
    expect(windows.toasts).toHaveLength(0);
    expect(platform.writeClipboardImage).toHaveBeenCalledOnce();
  });

  it.each([
    ['a path that is not a PNG', 'C:\\Users\\tester\\notes.txt'],
    ['a relative path', 'screenshot.png'],
    ['a file that does not exist', 'C:\\Users\\tester\\missing.png'],
  ])('refuses %s', async (_name, path) => {
    const { controller, windows, platform } = withFile();
    await controller.openFile({ path, width: 10, height: 10 });
    expect(windows.sessions).toHaveLength(0);
    expect(platform.notices[0]?.title).toBe('Capture Studio could not open');
  });

  it('refuses a file that is not a PNG inside', async () => {
    const { controller, fs, platform } = withFile();
    fs.files.set(PATH.toLowerCase(), Buffer.from('not a png at all, just text'));
    await controller.openFile({ path: PATH, width: 10, height: 10 });
    expect(platform.notices[0]?.body).toBe('That screenshot could not be read.');
  });
});

describe('opening an image from memory', () => {
  it('opens the PNG as it is, without saving or copying it', async () => {
    const { controller, windows, fs, platform } = setup(studioSettings({ autoCopy: true }));
    await controller.openImage(makePng(300, 200), { width: 1, height: 1 });
    expect(fs.files.size).toBe(0);
    expect(platform.writeClipboardImage).not.toHaveBeenCalled();
    expect(windows.sessions[0]).toMatchObject({
      width: 300,
      height: 200,
      savedPath: null,
      source: 'circle',
    });
  });

  it('opens even when the preview setting is off: the user asked for it', async () => {
    const { controller, windows } = setup(studioSettings({ openStudio: false }));
    await controller.openImage(makePng(300, 200), { width: 300, height: 200 }, 'file');
    expect(windows.window?.show).toHaveBeenCalled();
    expect(windows.sessions[0]?.source).toBe('file');
  });

  it('refuses bytes that are not a PNG', async () => {
    const { controller, windows, platform } = setup();
    await controller.openImage(Buffer.from('nope'), { width: 1, height: 1 });
    expect(windows.sessions).toHaveLength(0);
    expect(platform.notices[0]?.body).toBe('That image could not be opened.');
  });

  it('replaces a preview that is already open', async () => {
    const { controller, windows, captures } = setup();
    await controller.capture('hotkey');
    await controller.openImage(makePng(300, 200), { width: 300, height: 200 });
    expect(captures.get('session-1')).toBeUndefined();
    expect(controller.current()?.id).toBe('session-2');
    expect(windows.window?.visible).toBe(true);
  });
});

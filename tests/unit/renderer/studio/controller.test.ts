import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@renderer/components/Toast';
import type { StudioSession, SynthesizeResult } from '@shared/ipc/types';
import {
  createHarness,
  EDITED_BYTES,
  gate,
  makeSession,
  makeSettings,
  SAVED_PATH,
  type Harness,
} from './support';

function toastTitles(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.title);
}

async function open(harness: Harness, session: StudioSession = makeSession()): Promise<void> {
  await harness.controller.start();
  await act(async () => {
    await harness.controller.onSession(session);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.useRealTimers();
  act(() => useToastStore.getState().clear());
});

describe('starting', () => {
  it('subscribes to the main process and loads the settings', async () => {
    const harness = createHarness({ settings: makeSettings({ capture: { shutterSound: false } }) });
    const stop = await harness.controller.start();
    expect(harness.listenerCount('studio:session')).toBe(1);
    expect(harness.listenerCount('studio:cancel')).toBe(1);
    expect(harness.store.getState().settings?.capture.shutterSound).toBe(false);
    stop();
    expect(harness.listenerCount('studio:session')).toBe(0);
    expect(harness.shutter.dispose).toHaveBeenCalled();
  });

  it('opens a session that was already waiting when the page loaded', async () => {
    const harness = createHarness({ handlers: { 'studio:getSession': () => makeSession() } });
    await harness.controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.store.getState().session?.id).toBe('session-1');
    expect(harness.inputsOf('studio:ready')).toEqual([{ sessionId: 'session-1' }]);
  });

  it('follows the theme the main process announces', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit('theme:changed', { theme: 'light' });
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

describe('a new capture', () => {
  it('decodes the image, shows it and tells main the window can appear', async () => {
    const harness = createHarness();
    await open(harness);
    const state = harness.store.getState();
    expect(harness.decode).toHaveBeenCalledWith('beekeeper://app/capture/session-1.png');
    expect(state.session?.id).toBe('session-1');
    expect(state.visible).toBe(true);
    expect(state.imageUrl).toBe('beekeeper://app/capture/session-1.png');
    expect(state.imageSize).toEqual({ width: 1920, height: 1080 });
    expect(state.edited).toBe(false);
    expect(harness.inputsOf('studio:ready')).toEqual([{ sessionId: 'session-1' }]);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('uses the size of the session when the image reports none', async () => {
    const harness = createHarness({ image: { width: 0, height: 0 } });
    await open(harness, makeSession({ width: 800, height: 600 }));
    expect(harness.store.getState().imageSize).toEqual({ width: 800, height: 600 });
  });

  it('ignores the same session when it arrives twice (event and getSession)', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.onSession(makeSession());
    });
    expect(harness.decode).toHaveBeenCalledOnce();
    expect(harness.inputsOf('studio:ready')).toHaveLength(1);
  });

  it('plays the shutter only when both the shutter and the earcons are on', async () => {
    const on = createHarness({
      settings: makeSettings({ capture: { shutterSound: true }, voice: { earcons: true } }),
    });
    await open(on);
    expect(on.shutter.play).toHaveBeenCalledOnce();

    const noShutter = createHarness({
      settings: makeSettings({ capture: { shutterSound: false }, voice: { earcons: true } }),
    });
    await open(noShutter);
    expect(noShutter.shutter.play).not.toHaveBeenCalled();

    const noEarcons = createHarness({
      settings: makeSettings({ capture: { shutterSound: true }, voice: { earcons: false } }),
    });
    await open(noEarcons);
    expect(noEarcons.shutter.play).not.toHaveBeenCalled();
  });

  it('reports an image that cannot be decoded and never says it is ready', async () => {
    const harness = createHarness();
    harness.decode.mockRejectedValueOnce(new Error('bad image'));
    await open(harness);
    expect(harness.inputsOf('studio:ready')).toEqual([]);
    expect(harness.inputsOf('app:log')[0]).toMatchObject({ level: 'error', scope: 'studio' });
    expect(harness.store.getState().visible).toBe(false);
  });

  it('drops a session that was replaced while its image was still decoding', async () => {
    const harness = createHarness();
    const slow = gate();
    harness.decode.mockImplementationOnce(async () => {
      await slow.promise;
      return { naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement;
    });
    await harness.controller.start();
    const first = harness.controller.onSession(makeSession({ id: 'first' }));
    await harness.controller.onSession(makeSession({ id: 'second' }));
    slow.open();
    await first;
    expect(harness.store.getState().session?.id).toBe('second');
    expect(harness.inputsOf('studio:ready')).toEqual([{ sessionId: 'second' }]);
  });

  it('starts from a clean slate and frees the previous edited picture', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.completeEdit({
        ops: [],
        crop: { x: 0, y: 0, width: 100, height: 100 },
      });
    });
    expect(harness.store.getState().edited).toBe(true);
    await act(async () => {
      await harness.controller.onSession(makeSession({ id: 'session-2' }));
    });
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith('blob:edited-1');
    expect(harness.store.getState().edited).toBe(false);
    expect(harness.store.getState().mode).toBe('view');
  });
});

describe('closing', () => {
  it('plays the exit animation first and then tells main, once', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.beginExit();
    expect(harness.store.getState().visible).toBe(false);
    expect(harness.inputsOf('studio:close')).toEqual([]);
    await act(async () => {
      await harness.controller.acknowledgeClosed();
      await harness.controller.acknowledgeClosed();
    });
    expect(harness.inputsOf('studio:close')).toEqual([{ sessionId: 'session-1' }]);
    expect(harness.store.getState().session).toBeNull();
    expect(harness.player.stop).toHaveBeenCalled();
  });

  it('closes anyway when the exit animation never reports back', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.beginExit();
    await vi.advanceTimersByTimeAsync(900);
    expect(harness.inputsOf('studio:close')).toEqual([{ sessionId: 'session-1' }]);
  });

  it('closes when main asks it to (display change, dismiss timer)', async () => {
    const harness = createHarness();
    await open(harness);
    harness.emit('studio:cancel', { reason: 'display-change' });
    expect(harness.store.getState().visible).toBe(false);
  });

  it('acknowledges at once when the preview was never shown', async () => {
    const harness = createHarness();
    harness.decode.mockImplementation(() => new Promise(() => undefined));
    await harness.controller.start();
    void harness.controller.onSession(makeSession());
    await vi.advanceTimersByTimeAsync(0);
    harness.controller.beginExit();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.inputsOf('studio:close')).toEqual([{ sessionId: 'session-1' }]);
  });

  it('does not close a newer capture when the old exit animation finishes late', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.beginExit();
    await act(async () => {
      await harness.controller.onSession(makeSession({ id: 'session-2' }));
    });
    await act(async () => {
      await harness.controller.acknowledgeClosed();
    });
    expect(harness.inputsOf('studio:close')).toEqual([]);
    expect(harness.store.getState().session?.id).toBe('session-2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.inputsOf('studio:close')).toEqual([]);
  });

  it('does nothing when there is nothing open', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.controller.beginExit();
    await harness.controller.acknowledgeClosed();
    expect(harness.inputsOf('studio:close')).toEqual([]);
  });
});

describe('activity', () => {
  it('tells main about activity at most every 750 ms', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.noteActivity();
    harness.controller.noteActivity();
    await vi.advanceTimersByTimeAsync(800);
    harness.controller.noteActivity();
    expect(harness.inputsOf('studio:activity')).toEqual([{ busy: false }, { busy: false }]);
  });

  it('says it is busy while a menu or the editor is open, and idle again afterwards', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.toggleMenu('share');
    expect(harness.inputsOf('studio:activity').at(-1)).toEqual({ busy: true });
    harness.controller.closeMenu();
    expect(harness.inputsOf('studio:activity').at(-1)).toEqual({ busy: false });
    harness.controller.enterEdit();
    expect(harness.inputsOf('studio:activity').at(-1)).toEqual({ busy: true });
    harness.controller.cancelEdit();
    expect(harness.inputsOf('studio:activity').at(-1)).toEqual({ busy: false });
  });

  it('does not report anything while nothing is open', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.controller.noteActivity();
    harness.store.getState().setMenu('more');
    expect(harness.inputsOf('studio:activity')).toEqual([]);
  });

  it('opens and closes menus one at a time', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.toggleMenu('assist');
    expect(harness.store.getState().menu).toBe('assist');
    harness.controller.toggleMenu('more');
    expect(harness.store.getState().menu).toBe('more');
    harness.controller.toggleMenu('more');
    expect(harness.store.getState().menu).toBeNull();
  });
});

describe('copy', () => {
  it('copies, flashes a check and says so', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.copy();
    });
    expect(harness.inputsOf('studio:copy')).toEqual([{ sessionId: 'session-1' }]);
    expect(harness.store.getState().actions.copy).toBe('done');
    expect(toastTitles()).toEqual(['Copied to clipboard']);
    expect(harness.store.getState().announcement).toBe('Copied to clipboard');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(harness.store.getState().actions.copy).toBe('idle');
  });

  it('is busy while the request runs and ignores a second click', async () => {
    const harness = createHarness();
    const slow = gate();
    harness.handle('studio:copy', async () => {
      await slow.promise;
      return { ok: true };
    });
    await open(harness);
    const first = harness.controller.copy();
    expect(harness.store.getState().actions.copy).toBe('busy');
    await harness.controller.copy();
    expect(harness.inputsOf('studio:copy')).toHaveLength(1);
    slow.open();
    await act(async () => {
      await first;
    });
    expect(harness.store.getState().actions.copy).toBe('done');
  });

  it('sends the edited picture once there is one', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.completeEdit({
        ops: [],
        crop: { x: 0, y: 0, width: 400, height: 300 },
      });
      await harness.controller.copy();
    });
    expect(harness.inputsOf('studio:copy')).toEqual([
      { sessionId: 'session-1', png: EDITED_BYTES },
    ]);
  });

  it('shows the reason when copying fails', async () => {
    const harness = createHarness({
      handlers: { 'studio:copy': () => ({ ok: false, message: 'Could not copy the screenshot.' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.copy();
    });
    expect(harness.store.getState().actions.copy).toBe('error');
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Could not copy the screenshot',
      message: 'Could not copy the screenshot.',
      tone: 'error',
    });
  });

  it('survives a request that throws', async () => {
    const harness = createHarness({
      handlers: {
        'studio:copy': () => {
          throw new Error('Forbidden');
        },
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.copy();
    });
    expect(harness.store.getState().actions.copy).toBe('error');
    expect(toastTitles()).toEqual(['That did not work']);
  });

  it('does nothing without a session', async () => {
    const harness = createHarness();
    await harness.controller.start();
    await harness.controller.copy();
    expect(harness.inputsOf('studio:copy')).toEqual([]);
  });
});

describe('save', () => {
  it('saves and offers to show the file in its folder', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.save();
    });
    expect(harness.inputsOf('studio:save')).toEqual([{ sessionId: 'session-1' }]);
    const toast = useToastStore.getState().toasts[0];
    expect(toast).toMatchObject({ title: 'Saved', message: 'Beekeeper 2026-11-11 13.45.12.png' });
    expect(toast?.action?.label).toBe('Show in folder');

    await act(async () => {
      toast?.action?.onClick();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(harness.inputsOf('studio:share')).toEqual([
      { sessionId: 'session-1', target: 'reveal' },
    ]);
  });

  it('asks for a file name with Save as and stays silent when the dialog is cancelled', async () => {
    const harness = createHarness({ handlers: { 'studio:save': () => ({ ok: false }) } });
    await open(harness);
    await act(async () => {
      await harness.controller.save(true);
    });
    expect(harness.inputsOf('studio:save')).toEqual([{ sessionId: 'session-1', saveAs: true }]);
    expect(toastTitles()).toEqual([]);
    expect(harness.store.getState().actions.save).toBe('idle');
  });

  it('shows why saving failed', async () => {
    const harness = createHarness({
      handlers: { 'studio:save': () => ({ ok: false, message: 'Could not save the screenshot.' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.save();
    });
    expect(toastTitles()).toEqual(['Could not save the screenshot']);
  });
});

describe('pin, wallpaper and share', () => {
  it('pins and then closes the preview so the pin can be seen', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.pin();
    });
    expect(harness.inputsOf('studio:pin')).toEqual([{ sessionId: 'session-1' }]);
    expect(harness.store.getState().actions.pin).toBe('done');
    expect(harness.store.getState().visible).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(harness.store.getState().visible).toBe(false);
  });

  it('keeps the preview open when pinning fails', async () => {
    const harness = createHarness({
      handlers: { 'studio:pin': () => ({ ok: false, message: 'No.' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.pin();
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(harness.store.getState().visible).toBe(true);
    expect(toastTitles()).toEqual(['Could not pin the screenshot']);
  });

  it('sets the wallpaper and confirms with a toast', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.setWallpaper();
    });
    expect(harness.inputsOf('studio:wallpaper')).toEqual([{ sessionId: 'session-1' }]);
    expect(toastTitles()).toEqual(['Wallpaper updated']);
  });

  it('explains a wallpaper that could not be set', async () => {
    const harness = createHarness({
      handlers: { 'studio:wallpaper': () => ({ ok: false, message: 'Windows said no.' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.setWallpaper();
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Could not set the wallpaper',
      message: 'Windows said no.',
    });
  });

  it.each(['reveal', 'openWith'] as const)(
    'closes the preview at once after "%s", because the new window would open behind it',
    async (target) => {
      const harness = createHarness();
      await open(harness);
      await act(async () => {
        await harness.controller.share(target);
      });
      expect(harness.inputsOf('studio:share')).toEqual([{ sessionId: 'session-1', target }]);
      expect(harness.store.getState().visible).toBe(false);
    },
  );

  it('tells the user to paste after sharing as a file, then closes', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.share('file');
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Copied as a file',
      message: 'Paste it into a chat, an e-mail or a folder.',
    });
    expect(harness.store.getState().visible).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(harness.store.getState().visible).toBe(false);
  });

  it('tells the user to paste into the e-mail after Email…', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.share('mail');
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Screenshot copied',
      message: 'Paste it (Ctrl+V) into your e-mail.',
    });
  });

  it('stays open and explains when sharing fails', async () => {
    const harness = createHarness({
      handlers: { 'studio:share': () => ({ ok: false, message: 'Nope.' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.share('file');
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(harness.store.getState().visible).toBe(true);
    expect(toastTitles()).toEqual(['Could not share the screenshot']);
  });

  it('closes the menu that started the action', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.toggleMenu('share');
    await act(async () => {
      await harness.controller.share('file');
    });
    expect(harness.store.getState().menu).toBeNull();
  });
});

describe('the more menu', () => {
  it('deletes the screenshot, says so and closes', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.deleteScreenshot();
    });
    expect(harness.inputsOf('studio:delete')).toEqual([{ sessionId: 'session-1' }]);
    expect(toastTitles()).toEqual(['Moved to the Recycle Bin']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(harness.store.getState().visible).toBe(false);
  });

  it('keeps the preview when there was nothing to delete', async () => {
    const harness = createHarness({
      handlers: { 'studio:delete': () => ({ ok: false, message: 'Nothing to delete.' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.deleteScreenshot();
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(harness.store.getState().visible).toBe(true);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ message: 'Nothing to delete.' });
  });

  it('opens the screenshots folder and gets out of the way', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.openFolder();
    });
    expect(harness.inputsOf('studio:openFolder')).toHaveLength(1);
    expect(harness.store.getState().visible).toBe(false);
  });

  it('says so when the folder cannot be opened', async () => {
    const harness = createHarness({ handlers: { 'studio:openFolder': () => false } });
    await open(harness);
    await act(async () => {
      await harness.controller.openFolder();
    });
    expect(harness.store.getState().visible).toBe(true);
    expect(toastTitles()).toEqual(['Could not open the folder']);
  });

  it('asks main for a new capture', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.recapture();
    });
    expect(harness.inputsOf('capture:start')).toEqual([{}]);
  });

  it('opens the Capture page of Settings and closes the preview, which would hide it', async () => {
    const harness = createHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.openSettings();
    });
    expect(harness.inputsOf('window:openSettings')).toEqual([{ section: 'capture' }]);
    expect(harness.store.getState().visible).toBe(false);
  });

  it('survives failing requests', async () => {
    const harness = createHarness({
      handlers: {
        'studio:openFolder': () => {
          throw new Error('x');
        },
        'capture:start': () => {
          throw new Error('x');
        },
        'window:openSettings': () => {
          throw new Error('x');
        },
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.openFolder();
      await harness.controller.recapture();
      await harness.controller.openSettings();
    });
    expect(toastTitles()).toEqual([
      'Could not open the folder',
      'Could not take a new screenshot',
      'Could not open Settings',
    ]);
    expect(harness.store.getState().visible).toBe(true);
  });
});

describe('Photo assist: extract text', () => {
  it('shows a loading sheet, then the text', async () => {
    const slow = gate();
    const harness = createHarness({
      handlers: {
        'studio:assist': async () => {
          await slow.promise;
          return { ok: true, task: 'text', text: 'Hello world' };
        },
      },
    });
    await open(harness);
    const running = harness.controller.extractText();
    expect(harness.store.getState().sheet).toMatchObject({ open: true, status: 'loading' });
    slow.open();
    await act(async () => {
      await running;
    });
    expect(harness.store.getState().sheet).toMatchObject({
      open: true,
      status: 'done',
      text: 'Hello world',
    });
    expect(harness.inputsOf('studio:assist')).toEqual([{ sessionId: 'session-1', task: 'text' }]);
  });

  it('says when there is no text', async () => {
    const harness = createHarness({
      handlers: {
        'studio:assist': () => ({
          ok: true,
          task: 'text',
          text: '',
          message: 'No text found in this screenshot.',
        }),
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.extractText();
    });
    expect(harness.store.getState().sheet).toMatchObject({
      status: 'done',
      text: '',
      message: 'No text found in this screenshot.',
    });
  });

  it('shows an error, also when the request itself fails', async () => {
    const harness = createHarness({
      handlers: {
        'studio:assist': () => ({
          ok: false,
          task: 'text',
          message: 'Text recognition is not available in this build.',
        }),
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.extractText();
    });
    expect(harness.store.getState().sheet).toMatchObject({
      status: 'error',
      message: 'Text recognition is not available in this build.',
    });
    harness.handle('studio:assist', () => {
      throw new Error('Forbidden');
    });
    await act(async () => {
      await harness.controller.extractText();
    });
    expect(harness.store.getState().sheet).toMatchObject({
      status: 'error',
      message: 'The text could not be read.',
    });
  });

  it('ignores a result that arrives after the sheet was closed', async () => {
    const slow = gate();
    const harness = createHarness({
      handlers: {
        'studio:assist': async () => {
          await slow.promise;
          return { ok: true, task: 'text', text: 'late' };
        },
      },
    });
    await open(harness);
    const running = harness.controller.extractText();
    harness.controller.closeSheet();
    slow.open();
    await act(async () => {
      await running;
    });
    expect(harness.store.getState().sheet).toMatchObject({ open: false, text: '' });
  });

  it('copies the text and searches the web with it (then closes, the browser opens behind)', async () => {
    const harness = createHarness({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'text', text: 'red & blue' }) },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.extractText();
      await harness.controller.copyText();
    });
    expect(harness.inputsOf('studio:copyText')).toEqual([{ text: 'red & blue' }]);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Text copied',
      message: '10 characters',
    });

    await act(async () => {
      await harness.controller.searchText();
    });
    expect(harness.inputsOf('studio:searchText')).toEqual([{ text: 'red & blue' }]);
    expect(harness.store.getState().visible).toBe(false);
  });

  it('copies and searches nothing when there is no text', async () => {
    const harness = createHarness();
    await open(harness);
    await harness.controller.copyText();
    await harness.controller.searchText();
    expect(harness.inputsOf('studio:copyText')).toEqual([]);
    expect(harness.inputsOf('studio:searchText')).toEqual([]);
  });

  it('shows why copying or searching failed', async () => {
    const harness = createHarness({
      handlers: {
        'studio:assist': () => ({ ok: true, task: 'text', text: 'abc' }),
        'studio:copyText': () => ({ ok: false, message: 'busy' }),
        'studio:searchText': () => {
          throw new Error('x');
        },
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.extractText();
      await harness.controller.copyText();
      await harness.controller.searchText();
    });
    expect(toastTitles()).toEqual(['Could not copy the text', 'Could not open the browser']);
    expect(harness.store.getState().visible).toBe(true);
  });
});

describe('Photo assist: read aloud', () => {
  const audio = {
    format: 'f32',
    sampleRate: 22_050,
    data: new ArrayBuffer(8),
    durationMs: 10,
  } as SynthesizeResult;

  async function withText(harness: Harness, text = 'Hello world'): Promise<void> {
    harness.handle('studio:assist', () => ({ ok: true, task: 'text', text }));
    await open(harness);
    await act(async () => {
      await harness.controller.extractText();
    });
  }

  it('speaks the text and shows Stop while it plays', async () => {
    const harness = createHarness({ handlers: { 'speech:synthesize': () => audio } });
    const playing = gate();
    harness.player.play.mockImplementationOnce(() => playing.promise);
    await withText(harness);
    const speaking = harness.controller.toggleReadAloud();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.store.getState().sheet.speaking).toBe(true);
    expect(harness.inputsOf('speech:synthesize')).toEqual([{ text: 'Hello world' }]);
    expect(harness.player.play).toHaveBeenCalledWith(audio);
    playing.open();
    await act(async () => {
      await speaking;
    });
    expect(harness.store.getState().sheet.speaking).toBe(false);
  });

  it('stops when pressed again', async () => {
    const harness = createHarness({ handlers: { 'speech:synthesize': () => audio } });
    harness.player.play.mockImplementationOnce(() => new Promise(() => undefined));
    await withText(harness);
    void harness.controller.toggleReadAloud();
    await vi.advanceTimersByTimeAsync(0);
    await harness.controller.toggleReadAloud();
    expect(harness.player.stop).toHaveBeenCalled();
    expect(harness.store.getState().sheet.speaking).toBe(false);
  });

  it('hides the button when speech is not available', async () => {
    const harness = createHarness();
    await withText(harness);
    await act(async () => {
      await harness.controller.toggleReadAloud();
    });
    expect(harness.store.getState().sheet.readAloud).toBe('unavailable');
    expect(harness.store.getState().sheet.speaking).toBe(false);
  });

  it('does not play audio that was made after it was stopped', async () => {
    const slow = gate();
    const harness = createHarness({
      handlers: {
        'speech:synthesize': async () => {
          await slow.promise;
          return audio;
        },
      },
    });
    await withText(harness);
    const speaking = harness.controller.toggleReadAloud();
    harness.controller.closeSheet();
    slow.open();
    await act(async () => {
      await speaking;
    });
    expect(harness.player.play).not.toHaveBeenCalled();
  });

  it('speaks at most 4000 characters and nothing when there is no text', async () => {
    const harness = createHarness({ handlers: { 'speech:synthesize': () => audio } });
    await withText(harness, 'x'.repeat(5000));
    await act(async () => {
      await harness.controller.toggleReadAloud();
    });
    expect((harness.inputsOf('speech:synthesize')[0] as { text: string }).text).toHaveLength(4000);

    const empty = createHarness({ handlers: { 'speech:synthesize': () => audio } });
    await open(empty);
    await empty.controller.toggleReadAloud();
    expect(empty.inputsOf('speech:synthesize')).toEqual([]);
  });
});

describe('Photo assist: hide sensitive info', () => {
  const regions = [
    { kind: 'email', label: 'Email address', rect: { x: 10, y: 20, width: 200, height: 30 } },
    { kind: 'card', label: 'Card number', rect: { x: 10, y: 80, width: 300, height: 30 } },
  ] as const;

  function sensitiveHarness() {
    return createHarness({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'sensitive', regions: [...regions] }) },
    });
  }

  it('shows the areas for review, all selected', async () => {
    const harness = sensitiveHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    expect(harness.inputsOf('studio:assist')).toEqual([
      { sessionId: 'session-1', task: 'sensitive' },
    ]);
    const { redaction } = harness.store.getState();
    expect(redaction.status).toBe('review');
    expect(redaction.boxes.map((box) => [box.label, box.active])).toEqual([
      ['Email address', true],
      ['Card number', true],
    ]);
    expect(harness.store.getState().announcement).toBe('2 sensitive areas found');
  });

  it('lets the user keep an area visible or remove it', async () => {
    const harness = sensitiveHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    harness.controller.toggleRedaction('box-0');
    expect(harness.store.getState().redaction.boxes.map((box) => box.active)).toEqual([
      false,
      true,
    ]);
    harness.controller.removeRedaction('box-1');
    expect(harness.store.getState().redaction.boxes.map((box) => box.id)).toEqual(['box-0']);
    harness.controller.removeRedaction('box-0');
    expect(harness.store.getState().redaction).toEqual({ status: 'idle', boxes: [] });
  });

  it('blurs the selected areas into the picture at native resolution', async () => {
    const harness = sensitiveHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    harness.controller.toggleRedaction('box-0');
    await act(async () => {
      await harness.controller.applyRedaction();
    });
    expect(harness.flatten).toHaveBeenCalledOnce();
    const [, size, edit] = harness.flatten.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { ops: unknown[]; crop: unknown },
    ];
    expect(size).toEqual({ width: 1920, height: 1080 });
    expect(edit.crop).toBeNull();
    expect(edit.ops).toEqual([
      { id: 1, kind: 'blur', mode: 'pixelate', rect: { x: 10, y: 80, width: 300, height: 30 } },
    ]);
    const state = harness.store.getState();
    expect(state.edited).toBe(true);
    expect(state.imageUrl).toBe('blob:edited-1');
    expect(state.redaction).toEqual({ status: 'idle', boxes: [] });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ title: 'Sensitive info hidden' });
  });

  it('gives back the review when blurring fails', async () => {
    const harness = sensitiveHarness();
    harness.flatten.mockRejectedValueOnce(new Error('canvas'));
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
      await harness.controller.applyRedaction();
    });
    expect(harness.store.getState().redaction.status).toBe('review');
    expect(toastTitles()).toEqual(['Could not hide the sensitive info']);
  });

  it('cancels instead of blurring when nothing is selected', async () => {
    const harness = sensitiveHarness();
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    harness.controller.toggleRedaction('box-0');
    harness.controller.toggleRedaction('box-1');
    await act(async () => {
      await harness.controller.applyRedaction();
    });
    expect(harness.flatten).not.toHaveBeenCalled();
    expect(harness.store.getState().redaction.status).toBe('idle');
  });

  it('says so when nothing sensitive is found', async () => {
    const harness = createHarness({
      handlers: {
        'studio:assist': () => ({
          ok: true,
          task: 'sensitive',
          regions: [],
          message: 'No sensitive info found.',
        }),
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    expect(harness.store.getState().redaction.status).toBe('idle');
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'No sensitive info found',
      tone: 'info',
    });
  });

  it('explains a failed search and a request that throws', async () => {
    const harness = createHarness({
      handlers: {
        'studio:assist': () => ({ ok: false, task: 'sensitive', message: 'Cannot read.' }),
      },
    });
    await open(harness);
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: 'Could not look for sensitive info',
      message: 'Cannot read.',
      tone: 'error',
    });
    harness.handle('studio:assist', () => {
      throw new Error('Forbidden');
    });
    await act(async () => {
      await harness.controller.hideSensitive();
    });
    expect(harness.store.getState().redaction.status).toBe('idle');
  });

  it('forgets a search that was cancelled while it ran', async () => {
    const slow = gate();
    const harness = createHarness({
      handlers: {
        'studio:assist': async () => {
          await slow.promise;
          return { ok: true, task: 'sensitive', regions: [...regions] };
        },
      },
    });
    await open(harness);
    const running = harness.controller.hideSensitive();
    expect(harness.store.getState().redaction.status).toBe('loading');
    harness.controller.cancelRedaction();
    slow.open();
    await act(async () => {
      await running;
    });
    expect(harness.store.getState().redaction).toEqual({ status: 'idle', boxes: [] });
  });
});

describe('editing', () => {
  it('enters and leaves the editor, closing a menu on the way in', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.toggleMenu('more');
    harness.controller.enterEdit();
    expect(harness.store.getState()).toMatchObject({ mode: 'edit', menu: null });
    harness.controller.cancelEdit();
    expect(harness.store.getState().mode).toBe('view');
  });

  it('only leaves the editor when Done finds nothing changed', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.enterEdit();
    await act(async () => {
      await harness.controller.completeEdit({ ops: [], crop: null });
    });
    expect(harness.flatten).not.toHaveBeenCalled();
    expect(harness.store.getState()).toMatchObject({ mode: 'view', edited: false });
  });

  it('flattens the edits, shows the result and keeps its bytes for the actions', async () => {
    const harness = createHarness();
    await open(harness);
    harness.controller.enterEdit();
    const edit = {
      ops: [
        {
          id: 1,
          kind: 'rect',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          color: '#f00',
          width: 4,
        },
      ],
      crop: null,
    } as const;
    await act(async () => {
      await harness.controller.completeEdit(edit);
    });
    expect(harness.flatten).toHaveBeenCalledWith(
      expect.anything(),
      { width: 1920, height: 1080 },
      edit,
    );
    expect(harness.store.getState()).toMatchObject({
      mode: 'view',
      edited: true,
      imageUrl: 'blob:edited-1',
    });
    expect(harness.store.getState().actions.edit).toBe('done');
    expect(harness.createObjectUrl.mock.calls[0]?.[0]).toBeInstanceOf(Blob);

    await act(async () => {
      await harness.controller.pin();
    });
    expect(harness.inputsOf('studio:pin')).toEqual([{ sessionId: 'session-1', png: EDITED_BYTES }]);
  });

  it('frees the previous edited picture when a newer one replaces it, and on close', async () => {
    const harness = createHarness();
    await open(harness);
    const edit = { ops: [], crop: { x: 0, y: 0, width: 100, height: 100 } };
    await act(async () => {
      await harness.controller.completeEdit(edit);
      await harness.controller.completeEdit(edit);
    });
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith('blob:edited-1');
    expect(harness.revokeObjectUrl).not.toHaveBeenCalledWith('blob:edited-2');
    harness.controller.beginExit();
    await act(async () => {
      await harness.controller.acknowledgeClosed();
    });
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith('blob:edited-2');
  });

  it('stays in the editor and says so when flattening fails', async () => {
    const harness = createHarness();
    harness.flatten.mockRejectedValueOnce(new Error('canvas'));
    await open(harness);
    harness.controller.enterEdit();
    await act(async () => {
      await harness.controller.completeEdit({
        ops: [],
        crop: { x: 0, y: 0, width: 50, height: 50 },
      });
    });
    expect(harness.store.getState().mode).toBe('edit');
    expect(harness.store.getState().actions.edit).toBe('error');
    expect(toastTitles()).toEqual(['Could not apply the changes']);
  });

  it('frees a decoded edit that cannot be shown', async () => {
    const harness = createHarness();
    await open(harness);
    harness.decode.mockRejectedValueOnce(new Error('bad'));
    await act(async () => {
      await harness.controller.completeEdit({
        ops: [],
        crop: { x: 0, y: 0, width: 50, height: 50 },
      });
    });
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith('blob:edited-1');
    expect(harness.store.getState().edited).toBe(false);
  });

  it('exposes the decoded picture to the editor', async () => {
    const harness = createHarness();
    await open(harness);
    expect(harness.controller.currentImage?.naturalWidth).toBe(1920);
    expect(SAVED_PATH).toContain('Beekeeper');
  });
});

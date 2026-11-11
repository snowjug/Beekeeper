import { BrowserWindow, globalShortcut, nativeTheme } from 'electron';
import type { FeatureDeps } from '../features/types';
import { createElectronClipboard } from './clipboard.electron';
import { DictationController } from './controller';
import { createEscapeKey } from './escapeKey';
import { PillWindow } from './pill.electron';
import type { DictationFeature, Win32Services } from './types';
import { loadWin32Services } from './win32Services';

export type { DictationFeature, DictationSource, DictationState } from './types';

/**
 * Dictation anywhere: a hotkey (also the tray item and the "start dictation" command) opens a
 * small pill, the microphone is recorded in the pill's renderer, Whisper turns it into text and
 * the text is typed into the app that had the keyboard focus.
 */
export function createDictation(deps: FeatureDeps): DictationFeature {
  const { ctx, router, speech } = deps;
  const { logger, windows } = ctx;

  const clipboard = createElectronClipboard();
  let loading: Promise<Win32Services | null> | null = null;
  const services = (): Promise<Win32Services | null> => {
    loading ??= loadWin32Services({ clipboard, logger });
    return loading;
  };

  const pill = new PillWindow({
    windows,
    foreground: async () => (await services())?.foreground ?? null,
  });

  /** Windows of Beekeeper itself; a window that is not one of its roles (like a test page) is not. */
  const isOwnWindow = (handle: number): boolean =>
    BrowserWindow.getAllWindows().some(
      (win) =>
        !win.isDestroyed() &&
        windows.roleOf(win.webContents) !== null &&
        win.getNativeWindowHandle().readUInt32LE(0) === handle >>> 0,
    );

  const controller = new DictationController({
    logger,
    settings: () => ctx.settings.get(),
    // The service object is read at the moment of use (tests swap `transcribe` on it).
    speech,
    services,
    pill,
    escape: createEscapeKey(globalShortcut, logger),
    isOwnWindow,
    ownPid: process.pid,
    releaseOwnFocus: () => {
      ctx.assistant.hideImmediately();
    },
    stopAssistantListening: () =>
      windows.send('assistant', 'assistant:stopListening', { submit: false }),
    // The wake-word worker lets go of the microphone while the assistant bar is open.
    setWakePaused: (paused) => ctx.wake.setAssistantOpen(paused || ctx.assistant.isVisible()),
    setMicActive: (active) => ctx.trayState.setMicActive(active),
    hotkey: () => {
      const entry = ctx.hotkeys.status().dictation;
      return entry.registered ? entry.accelerator : null;
    },
    theme: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    clipboard,
  });

  router.handle('dictation:ready', () => {
    pill.markReady();
  });
  router.handle('dictation:submit', ({ samples }) => controller.submit(samples));
  router.handle('dictation:cancel', () => {
    controller.cancel('pill');
  });
  router.handle('dictation:abort', ({ reason, message }) => {
    controller.abort(reason, message);
  });

  return {
    toggle: (source) => controller.toggle(source),
    get active() {
      return controller.active;
    },
    get phase() {
      return controller.phase;
    },
    dispose() {
      controller.dispose();
      void loading?.then((loaded) => loaded?.injector.dispose());
    },
  };
}

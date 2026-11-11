import type { Logger } from '@shared/logger';
import { bindWin32Windows, createForegroundApi } from '../system/foreground';
import { bindWin32Input, createInputInjector, type ClipboardPort } from '../system/inputInjector';
import { loadKoffi, type KoffiLoader } from '../system/win32';
import type { Win32Services } from './types';

export interface Win32ServicesOptions {
  clipboard: ClipboardPort;
  logger: Logger;
  load?: KoffiLoader;
}

/** Loads the Win32 helpers; null (never a throw) when koffi is missing, blocked or not Windows. */
export async function loadWin32Services(
  options: Win32ServicesOptions,
): Promise<Win32Services | null> {
  try {
    const koffi = await (options.load ?? loadKoffi)();
    return {
      foreground: createForegroundApi(bindWin32Windows(koffi)),
      injector: createInputInjector({
        win32: bindWin32Input(koffi),
        clipboard: options.clipboard,
      }),
    };
  } catch (error) {
    options.logger.warn(
      'Dictation cannot type into other apps: the Windows input helpers did not load',
      error,
    );
    return null;
  }
}

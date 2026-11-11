import type { Logger } from '@shared/logger';
import type { EscapeKey } from './types';

/** The part of Electron's globalShortcut the Esc key needs. */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/**
 * Esc cancels a dictation, but the pill is a window that never takes the keyboard focus, so it
 * cannot hear the key. Esc is therefore registered as a global shortcut, and only for as long as
 * a dictation can be cancelled; the pill's close button works even when another app owns Esc.
 */
export function createEscapeKey(registry: ShortcutRegistry, logger: Logger): EscapeKey {
  let armed = false;
  return {
    arm(onPress) {
      if (armed) return true;
      try {
        armed = registry.register('Escape', onPress);
      } catch (error) {
        logger.warn('Esc could not be registered for dictation', error);
        armed = false;
      }
      if (!armed)
        logger.warn('Esc is used by another app: dictation can be cancelled with its button');
      return armed;
    },
    disarm() {
      if (!armed) return;
      armed = false;
      try {
        registry.unregister('Escape');
      } catch (error) {
        logger.warn('Esc could not be released', error);
      }
    },
  };
}

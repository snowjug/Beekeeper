import { clipboard, shell } from 'electron';
import type { Logger } from '@shared/logger';
import { parseSafeExternalUrl } from '@shared/url';
import type { UiBridge } from '../commands/types';
import type { ConfirmationServiceImpl } from '../services/confirmation';
import type { WindowManager } from '../windows/manager';
import type { WindowOpeners } from '../windows/openers';
import type { AssistantService } from './assistantService';

export interface UiBridgeDeps {
  windows: WindowManager;
  openers: WindowOpeners;
  confirmations: ConfirmationServiceImpl;
  /** Late-bound: the assistant service is created after the services that contain this bridge. */
  getAssistant: () => AssistantService;
  startCircle: () => void;
  logger: Logger;
}

/** What commands may ask the application shell to do. */
export function createUiBridge(deps: UiBridgeDeps): UiBridge {
  return {
    openSettings(section) {
      deps.openers.openSettings(section);
    },
    openCircleToSearch() {
      deps.startCircle();
    },
    stopSpeaking() {
      deps.windows.send('assistant', 'assistant:stopSpeaking', {});
    },
    cancelPending() {
      return {
        confirmations: deps.confirmations.cancelAll(),
        streams: deps.getAssistant().cancelStreams(),
      };
    },
    copyToClipboard(text) {
      void clipboard
        .writeText(text)
        .catch((error: unknown) => deps.logger.warn('Clipboard write failed', error));
    },
    getLastAnswerText() {
      return deps.getAssistant().getLastAnswerText();
    },
    async openExternal(url) {
      const safe = parseSafeExternalUrl(url);
      if (!safe) {
        deps.logger.warn('Refused to open a non-http(s) URL');
        return false;
      }
      try {
        await shell.openExternal(safe.href);
        return true;
      } catch (error) {
        deps.logger.warn('shell.openExternal failed', error);
        return false;
      }
    },
  };
}

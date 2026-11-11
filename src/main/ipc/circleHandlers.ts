import type { AiService } from '../ai/aiService';
import type { WindowManager } from '../windows/manager';
import type { CircleWindowController } from '../circle/windowController';
import type { CircleService } from '../circle/service';
import type { SecretName } from '../services/secureKeys';
import type { IpcRouter } from './router';
import type { SettingsView } from '@shared/settings';

export interface CircleHandlerDeps {
  service: CircleService;
  controller: CircleWindowController;
  windows: WindowManager;
}

/** Circle to Search: everything the overlay window may ask the main process to do. */
export function registerCircleHandlers(router: IpcRouter, deps: CircleHandlerDeps): void {
  const { service, controller, windows } = deps;

  router.handle('circle:getSession', () => (service.current() ? service.describe() : null));
  router.handle('circle:ready', ({ sessionId }) => {
    controller.markReady(sessionId);
  });
  router.handle('circle:ocr', ({ sessionId, rect }) => service.recognize(sessionId, rect));
  router.handle('circle:tap', ({ sessionId, point, whole }) =>
    service.tap(sessionId, point, whole),
  );
  router.handle('circle:copyImage', ({ sessionId, rect }) => service.copyImage(sessionId, rect));
  router.handle('circle:saveImage', ({ sessionId, rect }) => service.saveImage(sessionId, rect));
  router.handle('circle:searchImage', ({ sessionId, rect }) =>
    service.searchImage(sessionId, rect),
  );
  router.handle('circle:openText', ({ kind, text }) => service.openText(kind, text));
  router.handle('circle:smartAction', ({ type, value }) => service.smartAction(type, value));
  router.handle('circle:askAi', ({ sessionId, rect, question, streamId }) => {
    service.askAi(sessionId, rect, question, streamId, (event) => {
      windows.send('circle', 'circle:aiChunk', event);
    });
  });
  router.handle('circle:stopAi', () => {
    service.stopAi();
  });
  router.handle('circle:close', () => {
    controller.acknowledgeClosed();
  });
}

export interface AiHandlerDeps {
  ai: AiService;
  keys: {
    set(name: SecretName, value: string): Promise<void>;
    delete(name: SecretName): Promise<void>;
  };
  settingsView: () => SettingsView;
  windows: WindowManager;
}

/** Optional Azure features: keys (write-only from the UI), connection tests and the Speech token. */
export function registerAiHandlers(router: IpcRouter, deps: AiHandlerDeps): void {
  const refresh = (): SettingsView => {
    const view = deps.settingsView();
    deps.windows.broadcast('settings:changed', view);
    return view;
  };

  router.handle('ai:setKey', async ({ name, value }) => {
    await deps.keys.set(name, value);
    return refresh();
  });
  router.handle('ai:clearKey', async ({ name }) => {
    await deps.keys.delete(name);
    return refresh();
  });
  router.handle('ai:test', ({ service }) => deps.ai.test(service));
  router.handle('ai:speechToken', () => deps.ai.speechToken());
}

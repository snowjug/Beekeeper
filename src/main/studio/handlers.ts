import type { WindowRole } from '@shared/windows';
import type { IpcRouter } from '../ipc/router';
import type { StudioActions } from './actions';
import type { StudioController } from './controller';
import type { PinManager } from './pins';
import type { RestoreWindow } from './platform';

export interface StudioHandlerDeps {
  router: Pick<IpcRouter, 'handle'>;
  controller: Pick<
    StudioController,
    'capture' | 'describeCurrent' | 'markReady' | 'touch' | 'acknowledgeClosed'
  >;
  actions: StudioActions;
  pins: Pick<PinManager, 'info' | 'act'>;
  /** Hides the window with this web contents; returns how to bring it back (null: nothing was hidden). */
  hideWindow?: (contentsId: number) => RestoreWindow | null;
}

/** Ordinary windows with a capture button: they step aside so the picture shows what is behind them. */
const STEP_ASIDE_ROLES: ReadonlySet<WindowRole> = new Set<WindowRole>(['settings']);

/**
 * Everything the Studio and the pinned screenshots may ask the main process to do. Payloads are
 * validated by the router (zod); sessions are looked up here, so a request for a screenshot that
 * is no longer open never touches anything.
 */
export function registerStudioHandlers(deps: StudioHandlerDeps): void {
  const { router, controller, actions, pins, hideWindow } = deps;

  router.handle('capture:start', async (_input, { role, sender }) => {
    // The assistant bar is taken off the screen by the capture itself; the Studio by the controller.
    const stepAside =
      hideWindow && STEP_ASIDE_ROLES.has(role) ? () => hideWindow(sender.id) : undefined;
    await controller.capture('ui', stepAside);
  });

  router.handle('studio:getSession', () => controller.describeCurrent());
  router.handle('studio:ready', ({ sessionId }) => {
    controller.markReady(sessionId);
  });
  router.handle('studio:activity', ({ busy }) => {
    controller.touch(busy);
  });
  router.handle('studio:copy', ({ sessionId, png }) => actions.copy(sessionId, png));
  router.handle('studio:copyText', ({ text }) => actions.copyText(text));
  router.handle('studio:searchText', ({ text }) => actions.searchText(text));
  router.handle('studio:save', ({ sessionId, png, saveAs }) =>
    actions.save(sessionId, png, saveAs ?? false),
  );
  router.handle('studio:pin', ({ sessionId, png }) => actions.pin(sessionId, png));
  router.handle('studio:wallpaper', ({ sessionId, png }) => actions.wallpaper(sessionId, png));
  router.handle('studio:share', ({ sessionId, png, target }) =>
    actions.share(sessionId, target, png),
  );
  router.handle('studio:assist', ({ sessionId, png, task }) =>
    actions.assist(sessionId, task, png),
  );
  router.handle('studio:delete', ({ sessionId }) => actions.delete(sessionId));
  router.handle('studio:openFolder', () => actions.openFolder());
  router.handle('studio:close', ({ sessionId }) => {
    controller.acknowledgeClosed(sessionId);
  });

  router.handle('pin:getInfo', (_input, { sender }) => pins.info(sender.id));
  router.handle('pin:action', (action, { sender }) => pins.act(sender.id, action));
}

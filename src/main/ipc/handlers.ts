import { app, clipboard, nativeTheme, shell } from 'electron';
import type { HistoryEntry } from '@shared/cards';
import type { ConfirmResult, VoiceModelState } from '@shared/ipc/types';
import type { ModelProgress } from '@shared/models';
import { parseSafeExternalUrl } from '@shared/url';
import type { AppContext } from '../context';
import { isAllowedUserPath } from '../pathGuard';
import { displayUnderCursor } from '../windows/assistantController';
import { toVoiceModelState } from './modelState';
import type { IpcRouter } from './router';

const MIC_PRIVACY_URI = 'ms-settings:privacy-microphone';

/** Handlers for app basics, settings, windows, hotkeys, the assistant bar, voice model and updates. */
export function registerCoreHandlers(router: IpcRouter, ctx: AppContext): void {
  const { logger } = ctx;
  let lastProgress: ModelProgress | null = null;

  const modelState = (): VoiceModelState => toVoiceModelState(ctx.models.getStatus(), lastProgress);

  ctx.models.onProgress((progress) => {
    lastProgress = progress;
    ctx.windows.broadcast('voice:modelProgress', modelState());
  });

  // ---- app ----------------------------------------------------------------------------------
  router.handle('app:info', (_input, { role }) => ({
    name: 'Beekeeper',
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    isPackaged: ctx.packaged,
    isDev: ctx.dev,
    portable: ctx.portable,
    material: ctx.windows.materialFor(role),
    theme: nativeTheme.shouldUseDarkColors ? ('dark' as const) : ('light' as const),
    role,
    osBuild: ctx.windows.osBuild,
    userDataPath: ctx.paths.userData,
  }));

  router.handle('app:log', ({ level, scope, message, stack }) => {
    const scoped = logger.scope(`renderer:${scope}`);
    if (stack) scoped[level](message, stack);
    else scoped[level](message);
  });

  router.handle('app:openExternal', async ({ url }) => {
    const safe = parseSafeExternalUrl(url);
    if (!safe) return false;
    await shell.openExternal(safe.href);
    return true;
  });

  router.handle('app:copyText', async ({ text }) => {
    await clipboard.writeText(text);
  });

  router.handle('os:openMicSettings', async () => {
    await shell.openExternal(MIC_PRIVACY_URI);
    return true;
  });

  // ---- settings & hotkeys -------------------------------------------------------------------
  router.handle('settings:get', () => ctx.settingsView());
  router.handle('settings:update', (patch) => {
    ctx.settings.update(patch);
    return ctx.settingsView();
  });
  router.handle('hotkeys:status', () => ctx.hotkeys.status());
  router.handle('hotkeys:set', ({ id, accelerator }) => {
    const result = ctx.hotkeys.set(id, accelerator);
    if (result.ok) ctx.tray.refresh();
    return result;
  });

  // ---- windows ------------------------------------------------------------------------------
  router.handle('window:openSettings', ({ section }) => {
    ctx.openers.openSettings(section);
  });
  router.handle('window:openOnboarding', () => {
    ctx.openers.openOnboarding();
  });
  router.handle('window:closeSelf', (_input, { role }) => {
    if (role === 'settings' || role === 'onboarding' || role === 'circle') ctx.openers.close(role);
  });
  router.handle('onboarding:finish', () => {
    ctx.settings.update({ onboarding: { completed: true } });
    ctx.openers.close('onboarding');
    ctx.assistant.show({ listen: false, source: 'api' });
  });

  // ---- assistant bar ------------------------------------------------------------------------
  router.handle('assistant:submit', ({ text, source }) =>
    ctx.assistantService.submit(text, source),
  );

  router.handle('assistant:confirm', async ({ confirmId }): Promise<ConfirmResult> => {
    return ctx.confirmations.confirm(confirmId);
  });

  router.handle('assistant:cancelPending', ({ confirmId }) => {
    if (confirmId) return { cancelled: ctx.confirmations.cancel(confirmId) ? 1 : 0 };
    return { cancelled: ctx.confirmations.cancelAll() + ctx.assistantService.cancelStreams() };
  });

  router.handle('assistant:cardAction', async ({ action }) => {
    switch (action.type) {
      case 'url': {
        const safe = parseSafeExternalUrl(action.url);
        if (!safe) return false;
        await shell.openExternal(safe.href);
        return true;
      }
      case 'path': {
        if (!isAllowedUserPath(action.path, [ctx.paths.picturesDir, ctx.paths.logsDir])) {
          logger.warn('Refused to open a path outside Beekeeper folders');
          return false;
        }
        if (action.mode === 'reveal') {
          shell.showItemInFolder(action.path);
          return true;
        }
        return (await shell.openPath(action.path)) === '';
      }
      case 'command':
        // Commands are submitted by the renderer through assistant:submit.
        return false;
    }
  });

  router.handle('assistant:setPinned', ({ pinned }) => {
    ctx.assistant.setPinned(pinned);
  });
  router.handle('assistant:close', ({ reason }) => {
    ctx.assistant.hide(reason === 'escape' ? 'escape' : 'api');
  });
  router.handle('assistant:hidden', () => {
    ctx.assistant.acknowledgeHidden();
  });

  router.handle('assistant:history', ({ query, limit }) => {
    const entries: HistoryEntry[] = ctx.history.list(query, limit);
    return { entries, total: ctx.history.list(undefined, 1000).length };
  });
  router.handle('assistant:clearHistory', () => ctx.history.clear());
  router.handle('assistant:recall', ({ offset }) => ctx.history.recall(offset));
  router.handle('assistant:timers', () => ctx.timers.list());
  router.handle('assistant:cancelTimer', ({ id }) => ctx.timers.cancel(id));
  router.handle('assistant:stopStream', () => {
    ctx.assistantService.cancelStreams();
  });

  router.handle('glow:set', ({ active }) => {
    if (active) ctx.edgeGlow.show(displayUnderCursor());
    else ctx.edgeGlow.hide();
  });

  // ---- voice model --------------------------------------------------------------------------
  router.handle('voice:modelStatus', () => modelState());
  router.handle('voice:modelEnsure', () => {
    // A fresh run must not replay the previous run's (cancelled or failed) progress.
    lastProgress = null;
    void ctx.models.ensure();
    return modelState();
  });
  router.handle('voice:modelCancel', () => {
    ctx.models.cancel();
    return modelState();
  });
  router.handle('voice:modelRemove', async () => {
    await ctx.models.remove();
    lastProgress = null;
    // Removing the model must also stop the wake-word worker that depends on it.
    ctx.wake.evaluate();
    return modelState();
  });
  router.handle('voice:micActive', ({ active }) => {
    ctx.trayState.setMicActive(active);
  });
  router.handle('voice:wakeDetected', () => {
    ctx.wake.handleDetected();
  });
  router.handle('voice:workerStatus', ({ state, message }) => {
    ctx.wake.handleStatus({ state, ...(message ? { message } : {}) });
  });

  // ---- privacy, maintenance, updates ---------------------------------------------------------
  router.handle('privacy:clearNotes', () => ctx.notes.clear());
  router.handle('privacy:openLogs', async () => {
    await shell.openPath(ctx.paths.logsDir);
  });
  router.handle('updates:check', () => ctx.updates.check(true));
  router.handle('updates:install', () => {
    ctx.updates.install();
  });
  router.handle('updates:state', () => ctx.updates.getState());
}

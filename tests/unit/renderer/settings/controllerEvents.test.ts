import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@renderer/components/Toast';
import { clearToasts, gate, makeModel, makeView, startController, toastTitles } from './support';

afterEach(() => {
  clearToasts();
  document.documentElement.removeAttribute('data-theme');
});

describe('events from the main process', () => {
  it('applies theme changes, navigation, update, model and wake-word reports', async () => {
    const h = await startController();
    h.emit('theme:changed', { theme: 'light' });
    expect(document.documentElement.dataset['theme']).toBe('light');
    h.emit('settings:navigate', { section: 'privacy' });
    h.emit('updates:state', { status: 'ready', version: '1.1.0' });
    h.emit('voice:modelProgress', makeModel({ state: 'downloading', receivedBytes: 5 }));
    h.emit('voice:wakeStatus', { state: 'armed' });

    expect(h.controller.store.getState()).toMatchObject({
      section: 'privacy',
      updates: { status: 'ready', version: '1.1.0' },
      model: { state: 'downloading' },
      wake: { state: 'armed' },
    });
    h.stop();
  });

  it('re-reads hotkey status only when the configured hotkeys changed', async () => {
    const h = await startController();
    await waitFor(() => expect(h.inputsOf('hotkeys:status')).toHaveLength(1));

    h.emit('settings:changed', makeView());
    expect(h.inputsOf('hotkeys:status')).toHaveLength(1);

    h.emit(
      'settings:changed',
      makeView((view) => {
        view.hotkeys.circle = 'Ctrl+Alt+C';
      }),
    );
    await waitFor(() => expect(h.inputsOf('hotkeys:status')).toHaveLength(2));
    h.stop();
  });

  it('turns main-process toasts into toasts, wiring "Restart" to updates:install', async () => {
    const h = await startController({ handlers: { 'updates:install': () => undefined } });
    h.emit('toast:show', {
      title: 'Update ready',
      tone: 'success',
      action: { label: 'Restart', id: 'install-update' },
    });
    const toast = useToastStore.getState().toasts[0];
    expect(toast).toMatchObject({ title: 'Update ready', durationMs: 0 });
    toast?.action?.onClick();
    await waitFor(() => expect(h.inputsOf('updates:install')).toHaveLength(1));
    h.stop();
  });

  it('stops listening after cleanup', async () => {
    const h = await startController();
    h.stop();
    h.emit('settings:navigate', { section: 'about' });
    expect(h.controller.store.getState().section).toBe('general');
  });
});

describe('actions', () => {
  it('setHotkey returns the result and refreshes the status', async () => {
    const h = await startController({
      handlers: { 'hotkeys:set': () => ({ ok: true, accelerator: 'Ctrl+Alt+K' }) },
    });
    await waitFor(() => expect(h.inputsOf('hotkeys:status')).toHaveLength(1));
    await expect(h.controller.setHotkey('assistant', 'Ctrl+Alt+K')).resolves.toEqual({
      ok: true,
      accelerator: 'Ctrl+Alt+K',
    });
    expect(h.inputsOf('hotkeys:set')).toEqual([{ id: 'assistant', accelerator: 'Ctrl+Alt+K' }]);
    await waitFor(() => expect(h.inputsOf('hotkeys:status')).toHaveLength(2));
    h.stop();
  });

  it('setKey sends the key once and keeps only the masked hint', async () => {
    const h = await startController({
      handlers: {
        'ai:setKey': () =>
          makeView((view) => {
            view.secrets.speechKey = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221a2b';
          }),
      },
    });
    await h.controller.setKey('speech', 'super-secret-1a2b');
    expect(h.inputsOf('ai:setKey')).toEqual([{ name: 'speech', value: 'super-secret-1a2b' }]);
    expect(h.controller.store.getState().view?.secrets.speechKey).toBe(
      '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221a2b',
    );
    expect(JSON.stringify(h.controller.store.getState())).not.toContain('super-secret');
    h.stop();
  });

  it('testService waits for pending changes, and a failing handler is a friendly result', async () => {
    const release = gate();
    const h = await startController({
      handlers: {
        'settings:update': async () => {
          await release.promise;
          return makeView();
        },
        'ai:test': () => {
          throw new Error('No handler registered');
        },
      },
    });
    void h.controller.update({ ai: { speechRegion: 'westeurope' } });
    const testing = h.controller.testService('speech');
    await Promise.resolve();
    expect(h.inputsOf('ai:test')).toHaveLength(0);

    release.open();
    await expect(testing).resolves.toEqual({
      ok: false,
      message: 'Could not run the test. Please try again in a moment.',
    });
    expect(h.inputsOf('ai:test')).toEqual([{ service: 'speech' }]);
    h.stop();
  });

  it('checkForUpdates shows "checking", then the answer or a friendly error', async () => {
    const release = gate();
    let fail = false;
    const h = await startController({
      handlers: {
        'updates:check': async () => {
          await release.promise;
          if (fail) throw new Error('offline');
          return { status: 'none' as const };
        },
      },
    });
    const checking = h.controller.checkForUpdates();
    expect(h.controller.store.getState().updates.status).toBe('checking');
    release.open();
    await checking;
    expect(h.controller.store.getState().updates.status).toBe('none');

    fail = true;
    await h.controller.checkForUpdates();
    expect(h.controller.store.getState().updates).toEqual({ status: 'error', message: 'offline' });
    h.stop();
  });

  it('model actions update the card, and failures become toasts', async () => {
    const h = await startController({
      handlers: {
        'voice:modelEnsure': () => makeModel({ state: 'downloading' }),
        'voice:modelCancel': () => {
          throw new Error('Nothing to cancel');
        },
      },
    });
    await h.controller.ensureModel();
    expect(h.controller.store.getState().model?.state).toBe('downloading');
    await h.controller.cancelModel();
    expect(toastTitles()).toEqual(['Could not cancel the download']);
    expect(h.controller.store.getState().model?.state).toBe('downloading');
    h.stop();
  });

  it('openExternal and copyText report problems instead of failing silently', async () => {
    const h = await startController({
      handlers: { 'app:openExternal': () => false, 'app:copyText': () => undefined },
    });
    await h.controller.openExternal('https://example.com');
    expect(toastTitles()).toEqual(['Could not open the link']);
    await h.controller.copyText('C:\\data', 'Path');
    expect(toastTitles()).toEqual(['Could not open the link', 'Path copied']);
    h.stop();
  });
});

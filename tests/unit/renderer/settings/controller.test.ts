import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@renderer/components/Toast';
import { SettingsController } from '@renderer/settings/controller';
import { applyPatch } from '@renderer/settings/lib/patch';
import { createSettingsStore } from '@renderer/settings/store';
import {
  asPatch,
  clearToasts,
  createFakeBridge,
  gate,
  makeInfo,
  makeModel,
  makeView,
  startController,
} from './support';

afterEach(() => {
  clearToasts();
  document.documentElement.removeAttribute('data-theme');
});

describe('loading', () => {
  it('loads settings, app info, hotkey status, voice model and update state', async () => {
    const h = await startController({
      info: makeInfo({ theme: 'light' }),
      model: makeModel({ state: 'missing' }),
    });
    await waitFor(() => expect(h.controller.store.getState().model?.state).toBe('missing'));
    await waitFor(() => expect(h.controller.store.getState().hotkeys).not.toBeNull());

    const state = h.controller.store.getState();
    expect(state.view?.general.theme).toBe('system');
    expect(state.info?.version).toBe('1.0.0');
    expect(state.updates.status).toBe('idle');
    expect(document.documentElement.dataset['theme']).toBe('light');
    h.stop();
  });

  it('reports a failed load with a friendly message and recovers on retry', async () => {
    let healthy = false;
    const fake = createFakeBridge({
      'settings:get': () => {
        if (!healthy)
          throw new Error("Error invoking remote method 'settings:get': Error: disk is full");
        return makeView();
      },
      'app:info': () => makeInfo(),
      'hotkeys:status': () => ({
        assistant: { accelerator: 'Ctrl+Shift+Space', registered: true },
        circle: { accelerator: 'Alt+Shift+C', registered: true },
        capture: { accelerator: 'Alt+Shift+S', registered: true },
        dictation: { accelerator: 'Alt+Shift+D', registered: true },
      }),
      'voice:modelStatus': () => makeModel(),
      'updates:state': () => ({ status: 'idle' }),
      'app:log': () => undefined,
    });
    const controller = new SettingsController(fake.bridge, createSettingsStore());
    await controller.load();
    expect(controller.store.getState()).toMatchObject({
      phase: 'error',
      loadError: 'disk is full',
    });
    expect(fake.inputsOf('app:log')).toHaveLength(1);

    healthy = true;
    await controller.load();
    expect(controller.store.getState()).toMatchObject({ phase: 'ready', loadError: null });
  });
});

describe('update (optimistic)', () => {
  it('shows the change at once, sends exactly the minimal patch and reconciles with the answer', async () => {
    const release = gate();
    let main = makeView();
    const h = await startController({
      view: main,
      handlers: {
        'settings:get': () => main,
        'settings:update': async (patch) => {
          await release.promise;
          main = applyPatch(main, asPatch(patch));
          return main;
        },
      },
    });

    const done = h.controller.update({ general: { theme: 'dark' } });
    const before = h.controller.store.getState();
    expect(before.view?.general.theme).toBe('dark');
    expect(before.committed?.general.theme).toBe('system');
    expect(before.inflight).toHaveLength(1);
    expect(h.inputsOf('settings:update')).toEqual([{ general: { theme: 'dark' } }]);

    release.open();
    await expect(done).resolves.toBe(true);
    const after = h.controller.store.getState();
    expect(after.committed?.general.theme).toBe('dark');
    expect(after.inflight).toHaveLength(0);
    h.stop();
  });

  it('sends nothing when the value is already what the window shows', async () => {
    const h = await startController();
    await expect(h.controller.update({ general: { theme: 'system' } })).resolves.toBe(true);
    expect(h.inputsOf('settings:update')).toHaveLength(0);
    h.stop();
  });

  it('rolls back and shows an error toast when the main process rejects the change', async () => {
    const h = await startController({
      handlers: {
        'settings:update': () => {
          throw new Error(
            "Error invoking remote method 'settings:update': Error: Settings file is read-only",
          );
        },
      },
    });

    await expect(h.controller.update({ privacy: { saveHistory: false } })).resolves.toBe(false);

    expect(h.controller.store.getState().view?.privacy.saveHistory).toBe(true);
    expect(h.controller.store.getState().inflight).toHaveLength(0);
    const toast = useToastStore.getState().toasts[0];
    expect(toast).toMatchObject({
      title: 'Could not save that setting',
      message: 'Settings file is read-only',
      tone: 'error',
    });
    expect(h.inputsOf('app:log')).toHaveLength(1);
    h.stop();
  });

  it('keeps other in-flight changes when one of them is rejected', async () => {
    const first = gate();
    const second = gate();
    let main = makeView();
    const h = await startController({
      view: main,
      handlers: {
        'settings:get': () => main,
        'settings:update': async (input) => {
          const patch = asPatch(input);
          if (patch.voice) {
            await first.promise;
            throw new Error('Rejected');
          }
          await second.promise;
          main = applyPatch(main, patch);
          return main;
        },
      },
    });

    const a = h.controller.update({ voice: { earcons: false } });
    const b = h.controller.update({ general: { units: 'imperial' } });
    expect(h.controller.store.getState().view).toMatchObject({
      voice: { earcons: false },
      general: { units: 'imperial' },
    });

    first.open();
    await expect(a).resolves.toBe(false);
    expect(h.controller.store.getState().view).toMatchObject({
      voice: { earcons: true },
      general: { units: 'imperial' },
    });

    second.open();
    await expect(b).resolves.toBe(true);
    expect(h.controller.store.getState().committed?.general.units).toBe('imperial');
    h.stop();
  });

  it('keeps in-flight changes on top of settings:changed events', async () => {
    const release = gate();
    const h = await startController({
      handlers: {
        'settings:update': async () => {
          await release.promise;
          return makeView();
        },
      },
    });

    const pending = h.controller.update({ voice: { earcons: false } });
    h.emit(
      'settings:changed',
      makeView((view) => {
        view.general.units = 'imperial';
      }),
    );
    expect(h.controller.store.getState().view).toMatchObject({
      general: { units: 'imperial' },
      voice: { earcons: false },
    });
    release.open();
    await pending;
    h.stop();
  });

  it('flush() waits until every change was confirmed', async () => {
    const release = gate();
    const h = await startController({
      handlers: {
        'settings:update': async () => {
          await release.promise;
          return makeView();
        },
      },
    });
    void h.controller.update({ general: { units: 'imperial' } });

    let flushed = false;
    const flushing = h.controller.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release.open();
    await flushing;
    expect(flushed).toBe(true);
    h.stop();
  });

  it('re-reads the resolved theme after the theme setting changed', async () => {
    let dark = true;
    const h = await startController({
      handlers: { 'app:info': () => makeInfo({ theme: dark ? 'dark' : 'light' }) },
    });
    expect(document.documentElement.dataset['theme']).toBe('dark');
    dark = false;
    await h.controller.update({ general: { theme: 'light' } });
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('light'));
    h.stop();
  });
});

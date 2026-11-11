import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  disposeControllers,
  gate,
  logsOf,
  makeInfo,
  tick,
  type Harness,
  type HarnessOptions,
} from './support';

async function started(options: HarnessOptions = {}): Promise<Harness> {
  const harness = createHarness(options);
  await harness.controller.start();
  return harness;
}

const scaleOf = (harness: Harness): number | undefined => harness.store.getState().info?.scale;

afterEach(() => {
  disposeControllers();
  delete document.documentElement.dataset['theme'];
});

describe('start', () => {
  it('shows the pin the main process describes and follows the app theme', async () => {
    const harness = await started();
    expect(harness.store.getState().status).toBe('ready');
    expect(harness.store.getState().info).toEqual(makeInfo());
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('knows when the main process does not recognise the window', async () => {
    const harness = await started({ info: null });
    expect(harness.store.getState().status).toBe('missing');
    expect(harness.store.getState().info).toBeNull();
  });

  it('logs a failed lookup and shows the pin as unavailable', async () => {
    const harness = await started({
      handlers: {
        'pin:getInfo': () => {
          throw new Error('boom');
        },
      },
    });
    expect(harness.store.getState().status).toBe('missing');
    const [entry, ...rest] = logsOf(harness);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ level: 'error', scope: 'pin' });
    expect(entry?.message).toContain('boom');
  });

  it('still starts when the theme cannot be read', async () => {
    const harness = await started({
      handlers: {
        'app:info': () => {
          throw new Error('no theme');
        },
      },
    });
    expect(harness.store.getState().status).toBe('ready');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });

  it('prefers an update that arrived before the answer', async () => {
    const answer = gate();
    const harness = createHarness({
      handlers: {
        'pin:getInfo': async () => {
          await answer.promise;
          return makeInfo({ scale: 0.4 });
        },
      },
    });
    const running = harness.controller.start();
    harness.emit('pin:update', makeInfo({ scale: 0.9 }));
    answer.open();
    await running;
    expect(scaleOf(harness)).toBe(0.9);
  });
});

describe('updates of the main process', () => {
  it('shows the new zoom, opacity and click-through state', async () => {
    const harness = await started();
    harness.emit('pin:update', makeInfo({ scale: 1.5, opacity: 0.5, clickThrough: true }));
    expect(harness.store.getState().info).toMatchObject({
      scale: 1.5,
      opacity: 0.5,
      clickThrough: true,
    });
  });

  it('follows a theme change', async () => {
    const harness = await started();
    harness.emit('theme:changed', { theme: 'dark' });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('remembers a failed picture until the pin shows another one', async () => {
    const harness = await started();
    harness.controller.imageFailed();
    expect(harness.store.getState().imageFailed).toBe(true);
    harness.emit('pin:update', makeInfo({ scale: 2 }));
    expect(harness.store.getState().imageFailed).toBe(true);
    harness.emit('pin:update', makeInfo({ imageUrl: 'beekeeper://app/capture/other.png' }));
    expect(harness.store.getState().imageFailed).toBe(false);
  });

  it('logs a picture that could not be loaded', async () => {
    const harness = await started();
    harness.controller.imageFailed();
    await tick();
    expect(harness.inputsOf('app:log')).toEqual([expect.objectContaining({ level: 'warn' })]);
  });
});

describe('zooming', () => {
  it('shows a zoom at once and asks for it once per frame', async () => {
    const harness = await started();
    harness.controller.zoomTo(0.6, { x: 10, y: 20 });
    harness.controller.zoomTo(0.8, { x: 30, y: 40 });
    expect(scaleOf(harness)).toBe(0.8);
    expect(harness.actions()).toEqual([]);
    harness.frames.flush();
    expect(harness.actions()).toEqual([{ type: 'scale', value: 0.8, anchor: { x: 30, y: 40 } }]);
  });

  it('keeps the zoom between 10 % and 800 % and does not ask for what it already has', async () => {
    const harness = await started({ info: makeInfo({ scale: 8 }) });
    harness.controller.zoomTo(20);
    expect(harness.frames.pending).toBe(0);
    harness.controller.zoomTo(0.01);
    expect(scaleOf(harness)).toBe(0.1);
    harness.frames.flush();
    expect(harness.actions()).toEqual([{ type: 'scale', value: 0.1 }]);
  });

  it('zooms around the pointer when the wheel turns, compounding within a frame', async () => {
    const harness = await started();
    harness.controller.wheel({ deltaY: -100, deltaMode: 0, ctrlKey: false, x: 50, y: 60 });
    harness.controller.wheel({ deltaY: -100, deltaMode: 0, ctrlKey: false, x: 55, y: 62 });
    harness.frames.flush();
    const [action, ...others] = harness.actions();
    expect(others).toEqual([]);
    expect(action).toMatchObject({ type: 'scale', anchor: { x: 55, y: 62 } });
    expect(action?.['value']).toBeCloseTo(0.4 * Math.exp(0.3), 6);
  });

  it('changes the opacity instead when Ctrl is held', async () => {
    const harness = await started();
    harness.controller.wheel({ deltaY: 100, deltaMode: 0, ctrlKey: true, x: 5, y: 5 });
    expect(harness.store.getState().info?.opacity).toBe(0.95);
    expect(scaleOf(harness)).toBe(0.4);
    harness.frames.flush();
    expect(harness.actions()).toEqual([{ type: 'opacity', value: 0.95 }]);
  });

  it('zooms in steps from the keyboard and can return to 100 %', async () => {
    const harness = await started();
    harness.controller.zoomStep(1);
    expect(scaleOf(harness)).toBeCloseTo(0.5, 10);
    harness.controller.resetScale();
    expect(harness.actions()).toEqual([{ type: 'resetScale' }]);
  });

  it('keeps its own zoom while a request is on its way, then shows the final word', async () => {
    const answer = gate();
    const harness = await started({ handlers: { 'pin:action': () => answer.promise } });
    harness.controller.zoomTo(0.8);
    harness.frames.flush();
    // The main process clamped the request to what the window can be.
    harness.emit('pin:update', makeInfo({ scale: 0.5 }));
    expect(scaleOf(harness)).toBe(0.8);
    answer.open();
    await tick();
    expect(scaleOf(harness)).toBe(0.5);
  });

  it('does not flicker back while several requests are in flight', async () => {
    const first = gate();
    const second = gate();
    const queue = [first, second];
    const harness = await started({ handlers: { 'pin:action': () => queue.shift()?.promise } });
    harness.controller.zoomTo(0.8);
    harness.frames.flush();
    harness.controller.zoomTo(1);
    harness.frames.flush();
    harness.emit('pin:update', makeInfo({ scale: 0.8 }));
    expect(scaleOf(harness)).toBe(1);
    harness.emit('pin:update', makeInfo({ scale: 1 }));
    first.open();
    await tick();
    expect(scaleOf(harness)).toBe(1);
    second.open();
    await tick();
    expect(scaleOf(harness)).toBe(1);
  });

  it('logs a rejected zoom and goes back to what the main process says', async () => {
    const harness = await started({
      handlers: {
        'pin:action': () => {
          throw new Error('rejected');
        },
      },
    });
    harness.controller.zoomTo(3);
    expect(scaleOf(harness)).toBe(3);
    harness.frames.flush();
    await tick();
    expect(scaleOf(harness)).toBe(0.4);
    const [entry, ...rest] = logsOf(harness);
    expect(rest).toEqual([]);
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toContain('rejected');
  });
});

describe('opacity and moving', () => {
  it('limits the opacity to 10 %..100 % and asks for it once per frame', async () => {
    const harness = await started();
    harness.controller.setOpacity(0.5);
    harness.controller.setOpacity(0.01);
    expect(harness.store.getState().info?.opacity).toBe(0.1);
    harness.frames.flush();
    expect(harness.actions()).toEqual([{ type: 'opacity', value: 0.1 }]);
  });

  it('sends only the latest position of a drag in each frame', async () => {
    const harness = await started();
    harness.controller.moveTo({ x: 1, y: 2 });
    harness.controller.moveTo({ x: 5, y: 6 });
    expect(harness.actions()).toEqual([]);
    harness.frames.flush();
    expect(harness.actions()).toEqual([{ type: 'move', x: 5, y: 6 }]);
    harness.frames.flush();
    expect(harness.actions()).toHaveLength(1);
  });

  it('ignores zoom, opacity and wheel requests before the pin is known', async () => {
    const harness = await started({ info: null });
    harness.controller.zoomTo(2);
    harness.controller.setOpacity(0.5);
    harness.controller.wheel({ deltaY: -100, deltaMode: 0, ctrlKey: false, x: 0, y: 0 });
    expect(harness.frames.pending).toBe(0);
  });
});

describe('copy and save', () => {
  it('is busy while it runs, then done, then idle again', async () => {
    const answer = gate();
    const harness = await started({ handlers: { 'pin:action': () => answer.promise } });
    const copying = harness.controller.copy();
    expect(harness.store.getState().buttons.copy).toBe('busy');
    answer.open();
    await copying;
    expect(harness.store.getState().buttons.copy).toBe('done');
    await vi.waitFor(() => expect(harness.store.getState().buttons.copy).toBe('idle'));
    expect(harness.actions()).toEqual([{ type: 'copy' }]);
  });

  it('ignores a second press while the first one runs', async () => {
    const answer = gate();
    const harness = await started({ handlers: { 'pin:action': () => answer.promise } });
    const first = harness.controller.save();
    await harness.controller.save();
    answer.open();
    await first;
    expect(harness.actions()).toEqual([{ type: 'save' }]);
  });

  it('shows an error and logs it when the main process fails', async () => {
    const harness = await started({
      handlers: {
        'pin:action': () => {
          throw new Error('clipboard is locked');
        },
      },
    });
    await harness.controller.copy();
    expect(harness.store.getState().buttons.copy).toBe('error');
    const [entry, ...rest] = logsOf(harness);
    expect(rest).toEqual([]);
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toContain('clipboard is locked');
    await vi.waitFor(() => expect(harness.store.getState().buttons.copy).toBe('idle'));
  });
});

describe('the other requests', () => {
  it('asks the main process to close, open the menu and toggle click-through', async () => {
    const harness = await started();
    harness.controller.close();
    harness.controller.menu();
    harness.controller.setInteractive(true);
    harness.controller.setClickThrough(true);
    expect(harness.actions()).toEqual([
      { type: 'close' },
      { type: 'menu' },
      { type: 'interactive', value: true },
      { type: 'clickThrough', value: true },
    ]);
    expect(harness.store.getState().info?.clickThrough).toBe(true);
  });

  it('survives a request the main process rejects', async () => {
    const harness = await started({
      handlers: {
        'pin:action': () => {
          throw new Error('gone');
        },
      },
    });
    harness.controller.close();
    await tick();
    const [entry, ...rest] = logsOf(harness);
    expect(rest).toEqual([]);
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toContain('"close"');
  });
});

describe('dispose', () => {
  it('stops listening and drops a request that was waiting for its frame', async () => {
    const harness = await started();
    harness.controller.zoomTo(0.9);
    harness.controller.dispose();
    harness.frames.flush();
    expect(harness.actions()).toEqual([]);
    expect(harness.listenerCount('pin:update')).toBe(0);
    expect(harness.listenerCount('theme:changed')).toBe(0);
    harness.emit('pin:update', makeInfo({ scale: 3 }));
    expect(scaleOf(harness)).toBe(0.9);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@shared/logger';

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  workArea: { x: 0, y: 0, width: 1280, height: 680 },
  scaleFactor: 1.5,
};

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 1920, height: 1080 }) }) },
  screen: {
    getAllDisplays: () => [display],
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getPrimaryDisplay: () => display,
    on: vi.fn(),
  },
}));

const capture = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@main/capture/screen', () => ({
  captureDisplay: (...args: unknown[]): Promise<unknown> =>
    capture.run(...args) as Promise<unknown>,
}));

const { CircleWindowController } = await import('@main/circle/windowController');

class FakeWindow {
  visible = false;
  focused = true;
  readonly listeners = new Map<string, Array<() => void>>();
  readonly show = vi.fn(() => {
    this.visible = true;
  });
  readonly hide = vi.fn(() => {
    this.visible = false;
  });
  readonly focus = vi.fn();
  readonly setBounds = vi.fn();
  readonly setAlwaysOnTop = vi.fn();

  on(event: string, listener: () => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isFocused(): boolean {
    return this.focused;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

const loggerError = vi.fn();
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: loggerError };

function setup(options: { idleDestroyMs?: number; cancelOnBlur?: boolean } = {}) {
  let current: FakeWindow | undefined;
  const created: FakeWindow[] = [];
  const events: string[] = [];
  const send = vi.fn((_role: string, channel: string) => {
    events.push(channel);
  });
  const windows = {
    ensure: vi.fn(() => {
      if (!current) {
        current = new FakeWindow();
        created.push(current);
        events.push('window-created');
      }
      return current;
    }),
    get: () => current,
    whenLoaded: () => Promise.resolve(),
    send,
    destroy: vi.fn(() => {
      current = undefined;
      events.push('window-destroyed');
    }),
  };
  const service = {
    register: vi.fn(() => ({ id: 'session-1' })),
    end: vi.fn(),
  };
  const controller = new CircleWindowController({
    windows: windows as never,
    service: service as never,
    logger,
    clearScreen: () => false,
    notify: vi.fn(),
    ...options,
  });
  return { controller, windows, service, created, events, send };
}

/** Opens the overlay: the renderer confirms the frozen frame, then the window is shown. */
async function open(controller: InstanceType<typeof CircleWindowController>): Promise<void> {
  const opening = controller.toggle('test');
  await vi.advanceTimersByTimeAsync(0);
  controller.markReady('session-1');
  await opening;
}

describe('CircleWindowController window lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    capture.run.mockReset();
    capture.run.mockImplementation(() =>
      Promise.resolve({ image: {}, width: 1920, height: 1080, scaleFactor: 1.5, display }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates nothing until the hotkey is used', () => {
    const { windows } = setup();
    expect(windows.ensure).not.toHaveBeenCalled();
  });

  it('starts creating the window before the screenshot has finished', async () => {
    const { controller, events } = setup();
    let finishCapture: (value: unknown) => void = () => undefined;
    capture.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
    );
    const opening = controller.toggle('hotkey');
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['window-created']);

    finishCapture({ image: {}, width: 1920, height: 1080, scaleFactor: 1.5, display });
    await vi.advanceTimersByTimeAsync(0);
    controller.markReady('session-1');
    await opening;
    expect(controller.isOpen()).toBe(true);
  });

  it('shows the overlay on the display bounds once the renderer is ready', async () => {
    const { controller, created } = setup();
    await open(controller);
    const win = created[0];
    expect(win?.show).toHaveBeenCalledOnce();
    expect(win?.setBounds).toHaveBeenCalledWith(display.bounds);
    expect(win?.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('keeps the hidden window for the next use, then destroys it after the idle time', async () => {
    const { controller, windows, created } = setup({ idleDestroyMs: 5_000 });
    await open(controller);
    controller.cancel('api');
    controller.acknowledgeClosed();
    expect(created[0]?.hide).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_900);
    expect(windows.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(windows.destroy).toHaveBeenCalledWith('circle');
  });

  it('does not destroy the window while it is in use or when it is used again in time', async () => {
    const { controller, windows, created } = setup({ idleDestroyMs: 5_000 });
    await open(controller);
    controller.acknowledgeClosed();
    await vi.advanceTimersByTimeAsync(3_000);

    await open(controller);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(windows.destroy).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('wires blur handling again on the window it creates after a destroy', async () => {
    const { controller, created, events } = setup({ idleDestroyMs: 1_000 });
    await open(controller);
    controller.acknowledgeClosed();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(events).toContain('window-destroyed');

    await open(controller);
    expect(created).toHaveLength(2);
    expect(created[1]?.listeners.get('blur')).toHaveLength(1);
    expect(created[1]?.show).toHaveBeenCalledOnce();

    // Losing focus on the new window cancels the overlay, like on the first one.
    vi.setSystemTime(Date.now() + 2_000);
    created[1]!.focused = false;
    created[1]!.emit('blur');
    await vi.advanceTimersByTimeAsync(700);
    expect(events).toContain('circle:cancel');
  });

  it('closes cleanly and reports the failure when the screenshot cannot be taken', async () => {
    const { controller, service } = setup();
    capture.run.mockImplementation(() => Promise.reject(new Error('Windows refused')));
    await controller.toggle('hotkey');
    expect(controller.isOpen()).toBe(false);
    expect(service.end).toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalled();
  });
});

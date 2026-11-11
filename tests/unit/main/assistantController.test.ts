import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@shared/logger';

const display = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  workArea: { x: 0, y: 0, width: 1280, height: 680 },
  scaleFactor: 1.5,
};

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => [display],
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getPrimaryDisplay: () => display,
  },
}));

const { AssistantController } = await import('@main/windows/assistantController');

class FakeWindow {
  visible = false;
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

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  isVisible(): boolean {
    return this.visible;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function setup(options: { hideOnBlur?: boolean } = {}) {
  const win = new FakeWindow();
  const send = vi.fn();
  const windows = { ensure: () => win, get: () => win, send };
  const controller = new AssistantController({
    windows: windows as never,
    logger,
    ...options,
  });
  const visibility: boolean[] = [];
  controller.onVisibility((visible) => visibility.push(visible));
  return { controller, win, send, visibility };
}

const sentChannels = (send: ReturnType<typeof vi.fn>): string[] =>
  send.mock.calls.map((call) => String(call[1]));

describe('AssistantController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the pre-created window on top and tells the renderer', () => {
    const { controller, win, send, visibility } = setup();
    controller.show({ listen: true, source: 'hotkey' });
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'pop-up-menu');
    // Moving between monitors with different scaling needs two passes.
    expect(win.setBounds).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('assistant', 'assistant:show', {
      listen: true,
      source: 'hotkey',
    });
    expect(controller.isVisible()).toBe(true);
    expect(visibility).toEqual([true]);
  });

  it('hides in two steps: the renderer animates out, the window hides on acknowledgement', () => {
    const { controller, win, send, visibility } = setup();
    controller.show({ listen: false, source: 'api' });
    controller.hide('escape');
    expect(send).toHaveBeenLastCalledWith('assistant', 'assistant:hide', { reason: 'escape' });
    expect(win.hide).not.toHaveBeenCalled();
    controller.acknowledgeHidden();
    expect(win.hide).toHaveBeenCalledOnce();
    expect(visibility).toEqual([true, false]);
  });

  it('hides anyway when the renderer never acknowledges the exit animation', () => {
    const { controller, win } = setup();
    controller.show({ listen: false, source: 'api' });
    controller.hide('api');
    vi.advanceTimersByTime(800);
    expect(win.hide).toHaveBeenCalledOnce();
  });

  it('keeps the bar when it is shown again before the exit animation ends', () => {
    const { controller, win } = setup();
    controller.show({ listen: false, source: 'api' });
    controller.hide('hotkey');
    controller.show({ listen: true, source: 'hotkey' });
    controller.acknowledgeHidden();
    vi.advanceTimersByTime(1000);
    expect(win.hide).not.toHaveBeenCalled();
    expect(controller.isVisible()).toBe(true);
  });

  it('hides on blur, but not right after opening and not while pinned', () => {
    const { controller, win, send } = setup();
    controller.preload();
    controller.show({ listen: false, source: 'api' });
    win.emit('blur');
    expect(sentChannels(send)).not.toContain('assistant:hide');

    vi.advanceTimersByTime(400);
    controller.setPinned(true);
    win.emit('blur');
    expect(sentChannels(send)).not.toContain('assistant:hide');

    controller.setPinned(false);
    win.emit('blur');
    expect(send).toHaveBeenLastCalledWith('assistant', 'assistant:hide', { reason: 'blur' });
  });

  it('ignores blur when the option is off (automated tests)', () => {
    const { controller, win, send } = setup({ hideOnBlur: false });
    controller.preload();
    controller.show({ listen: false, source: 'api' });
    vi.advanceTimersByTime(1000);
    win.emit('blur');
    expect(sentChannels(send)).not.toContain('assistant:hide');
  });

  it('hideImmediately removes the bar at once, without waiting for an animation', () => {
    const { controller, win, visibility } = setup();
    expect(controller.hideImmediately()).toBe(false);
    controller.show({ listen: false, source: 'api' });
    expect(controller.hideImmediately()).toBe(true);
    expect(win.hide).toHaveBeenCalledOnce();
    expect(controller.isVisible()).toBe(false);
    expect(visibility).toEqual([true, false]);
  });

  describe('suspend / resume (screenshots)', () => {
    it('takes the bar off the screen and brings it back without ending the session', () => {
      const { controller, win, send, visibility } = setup();
      controller.show({ listen: false, source: 'api' });
      win.show.mockClear();

      expect(controller.suspend()).toBe(true);
      expect(win.visible).toBe(false);
      controller.resume();
      expect(win.visible).toBe(true);
      expect(win.show).toHaveBeenCalledOnce();
      expect(win.focus).toHaveBeenCalledTimes(2);
      // The renderer is never told to close, so its cards stay.
      expect(sentChannels(send)).toEqual(['assistant:show']);
      expect(controller.isVisible()).toBe(true);
      expect(visibility).toEqual([true]);
    });

    it('is not closed by the focus loss that hiding the window causes', () => {
      const { controller, win, send } = setup();
      controller.preload();
      controller.show({ listen: false, source: 'api' });
      vi.advanceTimersByTime(1000);
      controller.suspend();
      win.emit('blur');
      expect(sentChannels(send)).not.toContain('assistant:hide');
      controller.resume();
      win.emit('blur');
      expect(send).toHaveBeenLastCalledWith('assistant', 'assistant:hide', { reason: 'blur' });
    });

    it('does nothing when the bar is not showing', () => {
      const { controller, win } = setup();
      expect(controller.suspend()).toBe(false);
      controller.resume();
      expect(win.show).not.toHaveBeenCalled();
    });

    it('does not bring the bar back after it was closed meanwhile', () => {
      const { controller, win } = setup();
      controller.show({ listen: false, source: 'api' });
      controller.suspend();
      controller.hideImmediately();
      win.show.mockClear();
      controller.resume();
      expect(win.show).not.toHaveBeenCalled();
    });
  });
});

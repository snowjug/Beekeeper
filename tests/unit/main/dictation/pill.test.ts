import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForegroundApi } from '@main/system/foreground';

const display = vi.hoisted(() => ({
  workArea: { x: 0, y: 0, width: 1280, height: 680 },
}));
const screen = vi.hoisted(() => ({
  // Physical pixels at 150 % scaling.
  screenToDipPoint: vi.fn((point: { x: number; y: number }) => ({
    x: point.x / 1.5,
    y: point.y / 1.5,
  })),
  getDisplayNearestPoint: vi.fn((_point: { x: number; y: number }) => display),
  getCursorScreenPoint: vi.fn(() => ({ x: 5, y: 6 })),
}));
vi.mock('electron', () => ({ screen }));

const { PillWindow } = await import('@main/dictation/pill.electron');

class FakeWindow {
  visible = false;
  destroyed = false;
  readonly closed: Array<() => void> = [];
  readonly setBounds = vi.fn();
  readonly setAlwaysOnTop = vi.fn();
  readonly showInactive = vi.fn(() => {
    this.visible = true;
  });
  readonly hide = vi.fn(() => {
    this.visible = false;
  });

  once(_event: string, listener: () => void): this {
    this.closed.push(listener);
    return this;
  }
  isVisible(): boolean {
    return this.visible;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

const TARGET = { handle: 10, pid: 20 };

function setup(foreground: Partial<ForegroundApi> | null = {}) {
  let current: FakeWindow | undefined;
  const created: FakeWindow[] = [];
  const send = vi.fn();
  const destroy = vi.fn(() => {
    if (current) current.destroyed = true;
    current = undefined;
  });
  const windows = {
    ensure: vi.fn(() => {
      if (!current) {
        current = new FakeWindow();
        created.push(current);
      }
      return current;
    }),
    get: () => current,
    send,
    destroy,
  };
  const api: ForegroundApi | null = foreground && {
    current: () => TARGET,
    caretRect: () => null,
    windowRect: () => null,
    blocksInput: () => false,
    ...foreground,
  };
  const pill = new PillWindow({
    windows: windows as never,
    foreground: () => Promise.resolve(api),
    idleDestroyMs: 1000,
  });
  return { pill, windows, created, send, destroy, current: () => current };
}

beforeEach(() => {
  vi.useFakeTimers();
  screen.screenToDipPoint.mockClear();
  screen.getDisplayNearestPoint.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('show', () => {
  it('waits for the page, then shows the pill next to the caret without focusing it', async () => {
    const { pill, created } = setup({
      caretRect: () => ({ x: 600, y: 300, width: 3, height: 30 }),
    });
    const shown = pill.show(TARGET);
    await vi.advanceTimersByTimeAsync(0);
    expect(created[0]?.showInactive).not.toHaveBeenCalled();

    pill.markReady();
    await shown;
    const [win] = created;
    // 600/1.5 = 400, 300/1.5 = 200, caret 2 x 20 DIPs: x 400 - 40, y 200 + 20 + 14 - 10.
    expect(win?.setBounds).toHaveBeenCalledTimes(2);
    expect(win?.setBounds).toHaveBeenLastCalledWith({ x: 360, y: 224, width: 360, height: 84 });
    expect(win?.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(win?.showInactive).toHaveBeenCalledTimes(1);
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 400, y: 200 });
  });

  it('uses the display of the target window when the app has no caret', async () => {
    const { pill, created } = setup({
      windowRect: () => ({ x: 3000, y: 600, width: 600, height: 300 }),
    });
    const shown = pill.show(TARGET);
    pill.markReady();
    await shown;
    // The middle of the window: (3300, 750) pixels = (2200, 500) DIPs.
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 2200, y: 500 });
    expect(created[0]?.setBounds).toHaveBeenLastCalledWith({
      x: 460,
      y: 568,
      width: 360,
      height: 84,
    });
  });

  it('falls back to the cursor without a target', async () => {
    const { pill } = setup();
    const shown = pill.show(null);
    pill.markReady();
    await shown;
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 5, y: 6 });
  });

  it('works without the Win32 helpers', async () => {
    const { pill, created } = setup(null);
    const shown = pill.show(TARGET);
    pill.markReady();
    await shown;
    expect(created[0]?.showInactive).toHaveBeenCalled();
  });

  it('shows at once when the page is already ready', async () => {
    const { pill, created } = setup();
    const first = pill.show(null);
    pill.markReady();
    await first;
    pill.hide();

    await pill.show(null);
    expect(created).toHaveLength(1);
    expect(created[0]?.showInactive).toHaveBeenCalledTimes(2);
  });

  it('rejects when the page never reports ready', async () => {
    const { pill, created } = setup();
    const shown = pill.show(null);
    const outcome = expect(shown).rejects.toThrow('did not load');
    await vi.advanceTimersByTimeAsync(8000);
    await outcome;
    expect(created[0]?.showInactive).not.toHaveBeenCalled();
  });

  it('does not show a pill that was hidden while its page was loading', async () => {
    const { pill, created } = setup();
    const shown = pill.show(null);
    pill.hide();
    pill.markReady();
    await shown;
    expect(created[0]?.showInactive).not.toHaveBeenCalled();
  });

  it('waits for a new page after the window was destroyed', async () => {
    const { pill, created, destroy } = setup();
    const first = pill.show(null);
    pill.markReady();
    await first;

    pill.destroy();
    expect(destroy).toHaveBeenCalled();
    const second = pill.show(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(2);
    expect(created[1]?.showInactive).not.toHaveBeenCalled();
    pill.markReady();
    await second;
    expect(created[1]?.showInactive).toHaveBeenCalledTimes(1);
  });

  it('forgets the page when its window closes by itself', async () => {
    const { pill, created } = setup();
    const first = pill.show(null);
    pill.markReady();
    await first;
    for (const listener of created[0]?.closed ?? []) listener();

    // Until the page reports ready again nothing is shown.
    const again = pill.show(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(created[0]?.showInactive).toHaveBeenCalledTimes(1);
    pill.markReady();
    await again;
    expect(created[0]?.showInactive).toHaveBeenCalledTimes(2);
  });
});

describe('events and idle', () => {
  it('forwards start, stop and status to the pill page', () => {
    const { pill, send } = setup();
    const start = {
      language: 'en' as const,
      micDeviceId: 'default',
      silenceMs: 2000,
      maxSeconds: 60,
      earcons: true,
      theme: 'dark' as const,
      hotkey: 'Alt+Shift+D',
    };
    pill.start(start);
    pill.stop(true);
    pill.status({ phase: 'typing', text: 'hi' });
    expect(send.mock.calls).toEqual([
      ['dictation', 'dictation:start', start],
      ['dictation', 'dictation:stop', { submit: true }],
      ['dictation', 'dictation:status', { phase: 'typing', text: 'hi' }],
    ]);
  });

  it('hides the window and gives up its renderer after a quiet spell', async () => {
    const { pill, created, destroy } = setup();
    const shown = pill.show(null);
    pill.markReady();
    await shown;

    pill.hide();
    expect(created[0]?.hide).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the window when it was shown again before the idle time ended', async () => {
    const { pill, destroy } = setup();
    const shown = pill.show(null);
    pill.markReady();
    await shown;
    pill.hide();
    await pill.show(null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('can hide a pill that was never created', () => {
    const { pill, windows } = setup();
    expect(() => pill.hide()).not.toThrow();
    expect(windows.ensure).not.toHaveBeenCalled();
  });
});

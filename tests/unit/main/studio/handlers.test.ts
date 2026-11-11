import { describe, expect, it, vi } from 'vitest';
import { STUDIO_INVOKE } from '@shared/ipc/areas/studio.channels';
import { INVOKE_CHANNELS, canInvoke, type InvokeChannel } from '@shared/ipc/channels';
import { validateInvoke } from '@main/ipc/validate';
import type { StudioActions } from '@main/studio/actions';
import { registerStudioHandlers } from '@main/studio/handlers';
import type { RestoreWindow } from '@main/studio/platform';
import { makePng } from './support';

type Handler = (input: unknown, context: { role: string; sender: { id: number } }) => unknown;

function setup() {
  const handlers = new Map<string, Handler>();
  const router = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  };
  const actions = {
    copy: vi.fn(() => Promise.resolve({ ok: true })),
    copyText: vi.fn(() => Promise.resolve({ ok: true })),
    searchText: vi.fn(() => Promise.resolve({ ok: true })),
    save: vi.fn(() => Promise.resolve({ ok: true })),
    pin: vi.fn(() => Promise.resolve({ ok: true })),
    wallpaper: vi.fn(() => Promise.resolve({ ok: true })),
    share: vi.fn(() => Promise.resolve({ ok: true })),
    assist: vi.fn(() => Promise.resolve({ ok: true, task: 'text' })),
    delete: vi.fn(() => Promise.resolve({ ok: true })),
    openFolder: vi.fn(() => Promise.resolve(true)),
  };
  const controller = {
    capture: vi.fn((_source: string, _stepAside?: () => RestoreWindow | null) => Promise.resolve()),
    describeCurrent: vi.fn(() => null),
    markReady: vi.fn(),
    touch: vi.fn(),
    acknowledgeClosed: vi.fn(),
  };
  const pins = { info: vi.fn(() => null), act: vi.fn(() => Promise.resolve()) };
  const restore = vi.fn<RestoreWindow>();
  const hideWindow = vi.fn((_contentsId: number): RestoreWindow | null => restore);
  registerStudioHandlers({
    router: router as never,
    controller,
    actions: actions as unknown as StudioActions,
    pins,
    hideWindow,
  });
  const call = (channel: string, input?: unknown, senderId = 1, role = 'studio'): unknown => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler(input, { role, sender: { id: senderId } });
  };
  return { handlers, actions, controller, pins, call, hideWindow, restore };
}

describe('Studio IPC handlers', () => {
  it('registers a handler for every Capture Studio and pin channel, and for nothing else', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(Object.keys(STUDIO_INVOKE).sort());
  });

  it('answers only the windows the contract allows', () => {
    for (const channel of Object.keys(STUDIO_INVOKE) as InvokeChannel[]) {
      expect(Object.keys(INVOKE_CHANNELS)).toContain(channel);
    }
    expect(canInvoke('studio', 'studio:copy')).toBe(true);
    expect(canInvoke('assistant', 'studio:copy')).toBe(false);
    expect(canInvoke('circle', 'studio:save')).toBe(false);
    expect(canInvoke('pin', 'pin:action')).toBe(true);
    expect(canInvoke('studio', 'pin:action')).toBe(false);
    expect(canInvoke('settings', 'capture:start')).toBe(true);
    expect(canInvoke('assistant', 'capture:start')).toBe(true);
    expect(canInvoke('pin', 'capture:start')).toBe(false);
  });

  it('starts a capture from the interface', async () => {
    const { call, controller } = setup();
    await call('capture:start', {}, 1, 'assistant');
    expect(controller.capture).toHaveBeenCalledWith('ui', undefined);
  });

  it('steps the Settings window aside for the capture it asked for', async () => {
    const { call, controller, hideWindow, restore } = setup();
    await call('capture:start', {}, 7, 'settings');
    const [source, stepAside] = controller.capture.mock.calls[0] ?? [];
    expect(source).toBe('ui');
    // The controller decides when to hide it; nothing happens before that.
    expect(hideWindow).not.toHaveBeenCalled();
    expect(stepAside?.()).toBe(restore);
    expect(hideWindow).toHaveBeenCalledWith(7);
  });

  it('leaves the assistant bar and the Studio to their own handling', async () => {
    const { call, controller, hideWindow } = setup();
    await call('capture:start', {}, 2, 'assistant');
    await call('capture:start', {}, 3, 'studio');
    expect(controller.capture).toHaveBeenNthCalledWith(1, 'ui', undefined);
    expect(controller.capture).toHaveBeenNthCalledWith(2, 'ui', undefined);
    expect(hideWindow).not.toHaveBeenCalled();
  });

  it('gives the page its session and takes its handshake and activity messages', () => {
    const { call, controller } = setup();
    call('studio:getSession');
    call('studio:ready', { sessionId: 's' });
    call('studio:activity', { busy: true });
    call('studio:close', { sessionId: 's' });
    expect(controller.describeCurrent).toHaveBeenCalled();
    expect(controller.markReady).toHaveBeenCalledWith('s');
    expect(controller.touch).toHaveBeenCalledWith(true);
    expect(controller.acknowledgeClosed).toHaveBeenCalledWith('s');
  });

  it('forwards the actions with the session and the edited image', async () => {
    const { call, actions } = setup();
    const png = new Uint8Array([1, 2, 3]);
    await call('studio:copy', { sessionId: 's', png });
    await call('studio:save', { sessionId: 's', png, saveAs: true });
    await call('studio:save', { sessionId: 's' });
    await call('studio:pin', { sessionId: 's', png });
    await call('studio:wallpaper', { sessionId: 's' });
    await call('studio:share', { sessionId: 's', target: 'mail', png });
    await call('studio:assist', { sessionId: 's', task: 'sensitive', png });
    await call('studio:delete', { sessionId: 's' });
    await call('studio:openFolder');
    await call('studio:copyText', { text: 'hi' });
    await call('studio:searchText', { text: 'hi' });
    expect(actions.copy).toHaveBeenCalledWith('s', png);
    expect(actions.save).toHaveBeenNthCalledWith(1, 's', png, true);
    expect(actions.save).toHaveBeenNthCalledWith(2, 's', undefined, false);
    expect(actions.pin).toHaveBeenCalledWith('s', png);
    expect(actions.wallpaper).toHaveBeenCalledWith('s', undefined);
    expect(actions.share).toHaveBeenCalledWith('s', 'mail', png);
    expect(actions.assist).toHaveBeenCalledWith('s', 'sensitive', png);
    expect(actions.delete).toHaveBeenCalledWith('s');
    expect(actions.openFolder).toHaveBeenCalled();
    expect(actions.copyText).toHaveBeenCalledWith('hi');
    expect(actions.searchText).toHaveBeenCalledWith('hi');
  });

  it('identifies a pin by the window that sends the request', async () => {
    const { call, pins } = setup();
    call('pin:getInfo', undefined, 42);
    await call('pin:action', { type: 'close' }, 43);
    expect(pins.info).toHaveBeenCalledWith(42);
    expect(pins.act).toHaveBeenCalledWith(43, { type: 'close' });
  });
});

describe('Studio payload validation', () => {
  const png = makePng();

  it('drops a path sent by the page: it never reaches a handler', () => {
    expect(
      validateInvoke('studio:copy', { sessionId: 's', path: 'C:\\Windows\\System32\\cmd.exe' }),
    ).toEqual({ ok: true, data: { sessionId: 's' } });
    expect(
      validateInvoke('studio:share', { sessionId: 's', target: 'reveal', path: 'C:\\x.png' }),
    ).toEqual({ ok: true, data: { sessionId: 's', target: 'reveal' } });
  });

  it.each([
    ['studio:copy', { sessionId: 's', png }],
    ['studio:copy', { sessionId: 's' }],
    ['studio:save', { sessionId: 's', png, saveAs: true }],
    ['studio:share', { sessionId: 's', target: 'reveal' }],
    ['studio:assist', { sessionId: 's', task: 'text' }],
    ['studio:activity', { busy: false }],
    ['studio:close', { sessionId: 's' }],
    ['studio:copyText', { text: 'hello' }],
    ['capture:start', {}],
    ['capture:start', undefined],
    ['pin:action', { type: 'scale', value: 2, anchor: { x: 10, y: 20 } }],
    ['pin:action', { type: 'move', x: -100, y: 40 }],
    ['pin:action', { type: 'interactive', value: true }],
    ['pin:action', { type: 'menu' }],
  ] as const)('accepts %s %j', (channel, payload) => {
    expect(validateInvoke(channel, payload).ok).toBe(true);
  });

  it.each([
    ['studio:copy', { sessionId: '' }],
    ['studio:copy', { sessionId: 's', png: 'not bytes' }],
    ['studio:copy', { sessionId: 's', png: new Uint8Array() }],
    ['studio:copy', { sessionId: 's', png: [1, 2, 3] }],
    ['studio:share', { sessionId: 's', target: 'run' }],
    ['studio:assist', { sessionId: 's', task: 'qr' }],
    ['studio:save', { sessionId: 's', saveAs: 'yes' }],
    ['studio:copyText', { text: '' }],
    ['studio:searchText', { text: 'x'.repeat(4001) }],
    ['studio:close', undefined],
    ['pin:action', { type: 'scale', value: 100 }],
    ['pin:action', { type: 'scale', value: 0.01 }],
    ['pin:action', { type: 'opacity', value: 0 }],
    ['pin:action', { type: 'move', x: Number.NaN, y: 0 }],
    ['pin:action', { type: 'move', x: 1e12, y: 0 }],
    ['pin:action', { type: 'exec', command: 'calc' }],
  ] as const)('rejects %s %j', (channel, payload) => {
    expect(validateInvoke(channel, payload).ok).toBe(false);
  });
});

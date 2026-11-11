import { describe, expect, it, vi } from 'vitest';
import { bindWin32Windows, createForegroundApi, type Win32Windows } from '@main/system/foreground';
import type { KoffiLike } from '@main/system/win32';

interface FakeOptions {
  foreground?: number;
  pid?: number;
  threadId?: number;
  caret?: { window: number; left: number; top: number; right: number; bottom: number };
  guiThreadInfoOk?: boolean;
  clientOffset?: { x: number; y: number };
  clientToScreenOk?: boolean;
  rect?: { left: number; top: number; right: number; bottom: number } | null;
  /** Elevation of other processes by pid: undefined = cannot be opened, null = no token. */
  elevated?: Record<number, boolean | null | undefined>;
  selfElevated?: boolean | null;
}

const SELF = -1;

function fake(options: FakeOptions = {}) {
  const closed: number[] = [];
  const opened: number[] = [];
  const tokenOwners = new Map<number, number>();
  const closeHandle = vi.fn((handle: number) => {
    closed.push(handle);
    return 1;
  });
  const win32: Win32Windows = {
    getForegroundWindow: () => options.foreground ?? 0x1234,
    getWindowThreadProcessId: (_handle, pid) => {
      pid.writeUInt32LE(options.pid ?? 4321, 0);
      return options.threadId ?? 77;
    },
    getGuiThreadInfo: (_threadId, info) => {
      if (options.guiThreadInfoOk === false) return 0;
      const { window, left, top, right, bottom } = options.caret ?? {
        window: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      };
      info.writeBigUInt64LE(BigInt(window), 48);
      info.writeInt32LE(left, 56);
      info.writeInt32LE(top, 60);
      info.writeInt32LE(right, 64);
      info.writeInt32LE(bottom, 68);
      return 1;
    },
    clientToScreen: (_handle, point) => {
      if (options.clientToScreenOk === false) return 0;
      const offset = options.clientOffset ?? { x: 0, y: 0 };
      point.writeInt32LE(point.readInt32LE(0) + offset.x, 0);
      point.writeInt32LE(point.readInt32LE(4) + offset.y, 4);
      return 1;
    },
    getWindowRect: (_handle, rect) => {
      const value =
        options.rect === undefined ? { left: 10, top: 20, right: 410, bottom: 320 } : options.rect;
      if (!value) return 0;
      rect.writeInt32LE(value.left, 0);
      rect.writeInt32LE(value.top, 4);
      rect.writeInt32LE(value.right, 8);
      rect.writeInt32LE(value.bottom, 12);
      return 1;
    },
    openProcess: (_access, _inherit, pid) => {
      opened.push(pid);
      if (options.elevated?.[pid] === undefined) return 0;
      const handle = 1000 + pid;
      tokenOwners.set(handle, pid);
      return handle;
    },
    openProcessToken: (process, _access, token) => {
      const elevated =
        process === SELF
          ? options.selfElevated
          : options.elevated?.[tokenOwners.get(process) ?? -2];
      if (elevated === null || elevated === undefined) return 0;
      token[0] = 5000 + (elevated ? 1 : 0);
      return 1;
    },
    getTokenInformation: (token, _kind, info) => {
      info.writeUInt32LE(token === 5001 ? 1 : 0, 0);
      return 1;
    },
    closeHandle,
    getCurrentProcess: () => SELF,
  };
  return { win32, closed, opened, closeHandle };
}

describe('current', () => {
  it('returns the focused window and the process it belongs to', () => {
    const { win32 } = fake({ foreground: 0x9abc, pid: 555 });
    expect(createForegroundApi(win32).current()).toEqual({ handle: 0x9abc, pid: 555 });
  });

  it('returns null when Windows reports no foreground window', () => {
    const { win32 } = fake({ foreground: 0 });
    expect(createForegroundApi(win32).current()).toBeNull();
  });
});

describe('caretRect', () => {
  const window = { handle: 0x1234, pid: 4321 };

  it('converts the caret to screen coordinates', () => {
    const { win32 } = fake({
      caret: { window: 0x55, left: 12, top: 30, right: 14, bottom: 52 },
      clientOffset: { x: 100, y: 200 },
    });
    expect(createForegroundApi(win32).caretRect(window)).toEqual({
      x: 112,
      y: 230,
      width: 2,
      height: 22,
    });
  });

  it('gives a thin caret one pixel of width', () => {
    const { win32 } = fake({ caret: { window: 0x55, left: 5, top: 5, right: 5, bottom: 20 } });
    expect(createForegroundApi(win32).caretRect(window)?.width).toBe(1);
  });

  it.each<[string, FakeOptions]>([
    ['the app has no system caret', { caret: { window: 0, left: 0, top: 0, right: 0, bottom: 0 } }],
    ['the caret is empty', { caret: { window: 0x55, left: 5, top: 9, right: 7, bottom: 9 } }],
    ['the thread cannot be queried', { guiThreadInfoOk: false }],
    ['the window has no thread', { threadId: 0 }],
    [
      'the coordinates cannot be converted',
      {
        caret: { window: 0x55, left: 1, top: 1, right: 2, bottom: 10 },
        clientToScreenOk: false,
      },
    ],
  ])('returns null when %s', (_name, options) => {
    const { win32 } = fake(options);
    expect(createForegroundApi(win32).caretRect(window)).toBeNull();
  });
});

describe('windowRect', () => {
  const window = { handle: 0x1234, pid: 4321 };

  it('returns the window rectangle', () => {
    const { win32 } = fake();
    expect(createForegroundApi(win32).windowRect(window)).toEqual({
      x: 10,
      y: 20,
      width: 400,
      height: 300,
    });
  });

  it('returns null when the call fails or the window is empty', () => {
    expect(createForegroundApi(fake({ rect: null }).win32).windowRect(window)).toBeNull();
    expect(
      createForegroundApi(
        fake({ rect: { left: 5, top: 5, right: 5, bottom: 50 } }).win32,
      ).windowRect(window),
    ).toBeNull();
  });
});

describe('blocksInput', () => {
  const window = { handle: 1, pid: 800 };

  it('is true for an elevated app when Beekeeper is not elevated', () => {
    const { win32, closed } = fake({ elevated: { 800: true }, selfElevated: false });
    expect(createForegroundApi(win32).blocksInput(window)).toBe(true);
    // Both handles of the other process and the token of Beekeeper itself were released.
    expect(closed).toEqual([5001, 1800, 5000]);
  });

  it('is false when Beekeeper is elevated as well', () => {
    const { win32 } = fake({ elevated: { 800: true }, selfElevated: true });
    expect(createForegroundApi(win32).blocksInput(window)).toBe(false);
  });

  it('is false for an ordinary app', () => {
    const { win32 } = fake({ elevated: { 800: false }, selfElevated: false });
    expect(createForegroundApi(win32).blocksInput(window)).toBe(false);
  });

  it('is false when the process or its token cannot be read (SendInput decides then)', () => {
    expect(createForegroundApi(fake({ elevated: {} }).win32).blocksInput(window)).toBe(false);
    expect(createForegroundApi(fake({ elevated: { 800: null } }).win32).blocksInput(window)).toBe(
      false,
    );
  });

  it('reads Beekeeper’s own elevation only once', () => {
    const { win32 } = fake({ elevated: { 800: true }, selfElevated: false });
    const spy = vi.spyOn(win32, 'getCurrentProcess');
    const api = createForegroundApi(win32);
    api.blocksInput(window);
    api.blocksInput(window);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('bindWin32Windows', () => {
  it('declares every function it needs', () => {
    const declared: string[] = [];
    const koffi: KoffiLike = {
      load: (library) => ({
        func: (definition) => {
          declared.push(`${library}:${definition.split('(')[0] ?? ''}`);
          return vi.fn();
        },
      }),
    };
    bindWin32Windows(koffi);
    expect(declared).toEqual([
      'user32.dll:intptr_t GetForegroundWindow',
      'user32.dll:uint32 GetWindowThreadProcessId',
      'user32.dll:int GetGUIThreadInfo',
      'user32.dll:int ClientToScreen',
      'user32.dll:int GetWindowRect',
      'kernel32.dll:intptr_t OpenProcess',
      'advapi32.dll:int OpenProcessToken',
      'advapi32.dll:int GetTokenInformation',
      'kernel32.dll:int CloseHandle',
      'kernel32.dll:intptr_t GetCurrentProcess',
    ]);
  });
});

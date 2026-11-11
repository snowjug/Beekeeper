/**
 * Which window has the keyboard focus, where its text caret is and whether Windows would let
 * Beekeeper type into it (user32 / kernel32 / advapi32 called via koffi). Only handles, process
 * ids and rectangles are read: no window titles and no text content ever leave these calls.
 */
import { readHandle, type KoffiLike } from './win32';

export interface WindowRef {
  handle: number;
  pid: number;
}

export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The raw Win32 functions. Buffers are filled in place, exactly like the C structures. */
export interface Win32Windows {
  getForegroundWindow: () => number;
  /** Returns the thread id and writes the process id into the 4-byte `pid` buffer. */
  getWindowThreadProcessId: (handle: number, pid: Buffer) => number;
  getGuiThreadInfo: (threadId: number, info: Buffer) => number;
  clientToScreen: (handle: number, point: Buffer) => number;
  getWindowRect: (handle: number, rect: Buffer) => number;
  openProcess: (access: number, inherit: number, pid: number) => number;
  /** `token[0]` receives the token handle. */
  openProcessToken: (process: number, access: number, token: number[]) => number;
  getTokenInformation: (
    token: number,
    kind: number,
    info: Buffer,
    length: number,
    returned: number[],
  ) => number;
  closeHandle: (handle: number) => number;
  getCurrentProcess: () => number;
}

export interface ForegroundApi {
  /** The window that has the keyboard focus right now (null when Windows reports none). */
  current(): WindowRef | null;
  /** The text caret in physical screen pixels; null for apps that draw their own caret. */
  caretRect(window: WindowRef): PhysicalRect | null;
  windowRect(window: WindowRef): PhysicalRect | null;
  /** True when Windows would drop typed input for `window`: it runs elevated and Beekeeper not. */
  blocksInput(window: WindowRef): boolean;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x8;
const TOKEN_ELEVATION_CLASS = 20;
/** GUITHREADINFO on 64-bit Windows: two DWORDs, six handles and the caret RECT. */
const GUI_THREAD_INFO_SIZE = 72;
const CARET_WINDOW_OFFSET = 48;
const CARET_RECT_OFFSET = 56;

/** Binds the functions through koffi. */
export function bindWin32Windows(koffi: KoffiLike): Win32Windows {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  return {
    getForegroundWindow: user32.func(
      'intptr_t GetForegroundWindow()',
    ) as Win32Windows['getForegroundWindow'],
    getWindowThreadProcessId: user32.func(
      'uint32 GetWindowThreadProcessId(intptr_t hWnd, void *lpdwProcessId)',
    ) as Win32Windows['getWindowThreadProcessId'],
    getGuiThreadInfo: user32.func(
      'int GetGUIThreadInfo(uint32 idThread, void *pgui)',
    ) as Win32Windows['getGuiThreadInfo'],
    clientToScreen: user32.func(
      'int ClientToScreen(intptr_t hWnd, void *lpPoint)',
    ) as Win32Windows['clientToScreen'],
    getWindowRect: user32.func(
      'int GetWindowRect(intptr_t hWnd, void *lpRect)',
    ) as Win32Windows['getWindowRect'],
    openProcess: kernel32.func(
      'intptr_t OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)',
    ) as Win32Windows['openProcess'],
    openProcessToken: advapi32.func(
      'int OpenProcessToken(intptr_t ProcessHandle, uint32 DesiredAccess, _Out_ intptr_t *TokenHandle)',
    ) as Win32Windows['openProcessToken'],
    getTokenInformation: advapi32.func(
      'int GetTokenInformation(intptr_t TokenHandle, int TokenInformationClass, void *TokenInformation, uint32 TokenInformationLength, _Out_ uint32 *ReturnLength)',
    ) as Win32Windows['getTokenInformation'],
    closeHandle: kernel32.func('int CloseHandle(intptr_t hObject)') as Win32Windows['closeHandle'],
    getCurrentProcess: kernel32.func(
      'intptr_t GetCurrentProcess()',
    ) as Win32Windows['getCurrentProcess'],
  };
}

/** The elevation flag of a process token; null when the token cannot be read. */
function tokenElevated(win32: Win32Windows, process: number): boolean | null {
  const token = [0];
  if (!win32.openProcessToken(process, TOKEN_QUERY, token)) return null;
  const handle = token[0] ?? 0;
  try {
    const info = Buffer.alloc(4);
    if (!win32.getTokenInformation(handle, TOKEN_ELEVATION_CLASS, info, 4, [0])) return null;
    return info.readUInt32LE(0) !== 0;
  } finally {
    win32.closeHandle(handle);
  }
}

export function createForegroundApi(win32: Win32Windows): ForegroundApi {
  let selfElevated: boolean | undefined;

  const elevatedProcess = (pid: number): boolean | null => {
    const process = win32.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (process === 0) return null;
    try {
      return tokenElevated(win32, process);
    } finally {
      win32.closeHandle(process);
    }
  };

  return {
    current() {
      const handle = win32.getForegroundWindow();
      if (handle === 0) return null;
      const pid = Buffer.alloc(4);
      win32.getWindowThreadProcessId(handle, pid);
      return { handle, pid: pid.readUInt32LE(0) };
    },

    caretRect(window) {
      const threadId = win32.getWindowThreadProcessId(window.handle, Buffer.alloc(4));
      if (threadId === 0) return null;
      const info = Buffer.alloc(GUI_THREAD_INFO_SIZE);
      info.writeUInt32LE(GUI_THREAD_INFO_SIZE, 0);
      if (!win32.getGuiThreadInfo(threadId, info)) return null;

      const caretWindow = readHandle(info, CARET_WINDOW_OFFSET);
      const left = info.readInt32LE(CARET_RECT_OFFSET);
      const top = info.readInt32LE(CARET_RECT_OFFSET + 4);
      const right = info.readInt32LE(CARET_RECT_OFFSET + 8);
      const bottom = info.readInt32LE(CARET_RECT_OFFSET + 12);
      if (caretWindow === 0 || bottom <= top) return null;

      // The caret rectangle is relative to the window that owns the caret.
      const point = Buffer.alloc(8);
      point.writeInt32LE(left, 0);
      point.writeInt32LE(top, 4);
      if (!win32.clientToScreen(caretWindow, point)) return null;
      return {
        x: point.readInt32LE(0),
        y: point.readInt32LE(4),
        width: Math.max(1, right - left),
        height: bottom - top,
      };
    },

    windowRect(window) {
      const rect = Buffer.alloc(16);
      if (!win32.getWindowRect(window.handle, rect)) return null;
      const left = rect.readInt32LE(0);
      const top = rect.readInt32LE(4);
      const width = rect.readInt32LE(8) - left;
      const height = rect.readInt32LE(12) - top;
      return width > 0 && height > 0 ? { x: left, y: top, width, height } : null;
    },

    blocksInput(window) {
      if (elevatedProcess(window.pid) !== true) return false;
      selfElevated ??= tokenElevated(win32, win32.getCurrentProcess()) === true;
      return !selfElevated;
    },
  };
}

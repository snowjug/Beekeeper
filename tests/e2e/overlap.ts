import type { ElectronApplication } from '@playwright/test';
import koffi from 'koffi';

/**
 * Finds windows of OTHER programs that would end up in a screenshot of the app: a chat notification,
 * a pop-up, a floating widget. The README screenshots are taken from the screen, so everything that
 * is on top of the app's neutral backdrop window shows up in the picture. The generator uses this
 * to wait and retake (or to refuse) instead of publishing somebody's notification.
 *
 * It walks the windows from the top of the z-order down to the backdrop (the first window of the
 * app that covers the whole area) and reports every visible, uncloaked, not click-through window of
 * another process that overlaps the area by more than a sliver on the way. Windows below the
 * backdrop are hidden by it and are not reported. Only the process id and the executable name are
 * ever reported, never a window title, which can be private.
 */
export interface Area {
  /** Device-independent pixels, like Electron's window bounds. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Intruder {
  pid: number;
  /** Executable name without its folder ("ms-teams.exe"), or "" when it cannot be read. */
  program: string;
  /** Physical screen pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

koffi.struct('BkWindowRect', {
  left: 'int32_t',
  top: 'int32_t',
  right: 'int32_t',
  bottom: 'int32_t',
});
const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const kernel32 = koffi.load('kernel32.dll');
const setDpiAwareness = user32.func('intptr_t SetProcessDpiAwarenessContext(intptr_t value)') as (
  value: number,
) => number;
const topWindow = user32.func('intptr_t GetTopWindow(intptr_t hWnd)') as (hWnd: number) => number;
const nextWindow = user32.func('intptr_t GetWindow(intptr_t hWnd, uint32_t uCmd)') as (
  hWnd: number,
  command: number,
) => number;
const isVisible = user32.func('int IsWindowVisible(intptr_t hWnd)') as (hWnd: number) => number;
const windowRect = user32.func('int GetWindowRect(intptr_t hWnd, _Out_ BkWindowRect *lpRect)') as (
  hWnd: number,
  rect: Record<string, number>,
) => number;
const windowProcess = user32.func(
  'uint32_t GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)',
) as (hWnd: number, processId: number[]) => number;
const windowStyle = user32.func('intptr_t GetWindowLongPtrW(intptr_t hWnd, int nIndex)') as (
  hWnd: number,
  index: number,
) => number | bigint;
const cloakedState = dwmapi.func(
  'int DwmGetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, _Out_ int32_t *pvAttribute, uint32_t cbAttribute)',
) as (hWnd: number, attribute: number, value: number[], size: number) => number;
const openProcess = kernel32.func(
  'intptr_t OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)',
) as (access: number, inherit: number, processId: number) => number;
const closeHandle = kernel32.func('int CloseHandle(intptr_t hObject)') as (
  handle: number,
) => number;
const imageName = kernel32.func(
  'int QueryFullProcessImageNameW(intptr_t hProcess, uint32_t dwFlags, _Out_ uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
) as (handle: number, flags: number, buffer: Uint16Array, size: number[]) => number;

const GW_HWNDNEXT = 2;
const GWL_EXSTYLE = -20;
const DWMWA_CLOAKED = 14;
const WS_EX_TRANSPARENT = 0x20;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PER_MONITOR_AWARE_V2 = -4;
/** An overlap thinner than this (a sliver of an auto-hidden taskbar, a shadow) is not worth a retake. */
const MIN_OVERLAP_SIDE = 16;
const MAX_WINDOWS = 5_000;

let physicalPixels = false;
/** Window rectangles come back in physical pixels only for a DPI-aware process. */
function seePhysicalPixels(): void {
  if (physicalPixels) return;
  physicalPixels = true;
  try {
    setDpiAwareness(PER_MONITOR_AWARE_V2);
  } catch {
    // Already set: the calls below still work, with the coordinates Windows gives this process.
  }
}

function overlapSides(box: Box, area: Box): { width: number; height: number } {
  return {
    width: Math.min(box.right, area.right) - Math.max(box.left, area.left),
    height: Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top),
  };
}

/** A few pixels of slack: rounding at fractional scaling can make a full-screen window a pixel short. */
const COVER_SLACK = 4;

function covers(box: Box, area: Box): boolean {
  return (
    box.left <= area.left + COVER_SLACK &&
    box.top <= area.top + COVER_SLACK &&
    box.right >= area.right - COVER_SLACK &&
    box.bottom >= area.bottom - COVER_SLACK
  );
}

function programOf(processId: number): string {
  const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, processId);
  if (handle === 0) return '';
  try {
    const buffer = new Uint16Array(520);
    const size = [buffer.length];
    if (imageName(handle, 0, buffer, size) === 0) return '';
    const path = String.fromCharCode(...buffer.subarray(0, size[0] ?? 0));
    return path.slice(path.lastIndexOf('\\') + 1);
  } finally {
    closeHandle(handle);
  }
}

/** Windows of other programs above the app's backdrop inside `area` (see the file comment). */
export async function windowsOverApp(app: ElectronApplication, area: Area): Promise<Intruder[]> {
  seePhysicalPixels();
  // The app's own top-level windows are told apart by their handles (the process id Playwright
  // reports is not always the one that owns them).
  const { physical, own } = await app.evaluate(
    ({ BrowserWindow, screen }, dips) => ({
      physical: screen.dipToScreenRect(null, dips),
      own: BrowserWindow.getAllWindows().map((win) => win.getNativeWindowHandle().readUInt32LE(0)),
    }),
    {
      x: Math.round(area.x),
      y: Math.round(area.y),
      width: Math.round(area.width),
      height: Math.round(area.height),
    },
  );
  const ownHandles = new Set(own);
  const target: Box = {
    left: physical.x,
    top: physical.y,
    right: physical.x + physical.width,
    bottom: physical.y + physical.height,
  };

  const found: Intruder[] = [];
  let handle = topWindow(0);
  for (let steps = 0; handle !== 0 && steps < MAX_WINDOWS; steps += 1) {
    const current = handle;
    handle = nextWindow(current, GW_HWNDNEXT);
    if (isVisible(current) === 0) continue;
    const cloaked = [0];
    cloakedState(current, DWMWA_CLOAKED, cloaked, 4);
    if ((cloaked[0] ?? 0) !== 0) continue;
    const rect: Record<string, number> = {};
    windowRect(current, rect);
    const box: Box = {
      left: rect['left'] ?? 0,
      top: rect['top'] ?? 0,
      right: rect['right'] ?? 0,
      bottom: rect['bottom'] ?? 0,
    };
    if (ownHandles.has(current)) {
      // The backdrop: everything below it is hidden by it.
      if (covers(box, target)) break;
      continue;
    }
    const { width, height } = overlapSides(box, target);
    if (width < MIN_OVERLAP_SIDE || height < MIN_OVERLAP_SIDE) continue;
    // Click-through overlays (game bars, annotation layers) are see-through as well.
    if ((Number(windowStyle(current, GWL_EXSTYLE)) & WS_EX_TRANSPARENT) !== 0) continue;
    const owner = [0];
    windowProcess(current, owner);
    const processId = owner[0] ?? 0;
    found.push({
      pid: processId,
      program: programOf(processId),
      left: box.left,
      top: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
  }
  return found;
}

/** "ms-teams.exe, pid 4242, 360x246 at 1090,420": enough to find the program, nothing private. */
export function describeIntruder(intruder: Intruder): string {
  const program = intruder.program === '' ? 'unknown program' : intruder.program;
  return `${program}, pid ${intruder.pid}, ${intruder.width}x${intruder.height} at ${intruder.left},${intruder.top}`;
}

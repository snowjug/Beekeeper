/**
 * Types text into whatever app has the keyboard focus with SendInput (user32, called via koffi).
 *
 * Every character is sent as a KEYEVENTF_UNICODE key press, so the result does not depend on the
 * keyboard layout and works for Devanagari and emoji. Line breaks press Enter and tabs press Tab.
 * Events go out in small batches with a short pause so slow apps keep up; a key is never split
 * from its release and a surrogate pair never from its other half. Paste mode puts the text on
 * the clipboard, presses Ctrl+V and puts the old clipboard back afterwards.
 */
import type { KoffiLike } from './win32';

/** SendInput on 64-bit Windows: INPUT is 40 bytes (type, 4 bytes padding, the 32-byte union). */
export const INPUT_SIZE = 40;
export const MAX_BATCH_EVENTS = 64;

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const VK_TAB = 0x09;
const VK_RETURN = 0x0d;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;
const VK_V = 0x56;
const SCAN_TAB = 0x0f;
const SCAN_RETURN = 0x1c;
const SCAN_CONTROL = 0x1d;
const SCAN_V = 0x2f;
const MODIFIERS = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN] as const;

const BATCH_PAUSE_MS = 2;
const MODIFIER_POLL_MS = 25;
const MODIFIER_TIMEOUT_MS = 1500;
const PASTE_RESTORE_MS = 600;

export interface Win32Input {
  /** `inputs` holds `count` INPUT structures; returns how many events Windows accepted. */
  sendInput: (count: number, inputs: Buffer, size: number) => number;
  /** High bit set (negative) while the key is physically down. */
  getAsyncKeyState: (virtualKey: number) => number;
}

/** Binds SendInput and GetAsyncKeyState through koffi. */
export function bindWin32Input(koffi: KoffiLike): Win32Input {
  const user32 = koffi.load('user32.dll');
  return {
    sendInput: user32.func(
      'uint32 SendInput(uint32 cInputs, void *pInputs, int cbSize)',
    ) as Win32Input['sendInput'],
    getAsyncKeyState: user32.func(
      'int16 GetAsyncKeyState(int vKey)',
    ) as Win32Input['getAsyncKeyState'],
  };
}

export interface ClipboardPort {
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
  /** An opaque copy of everything on the clipboard, to be given back to `restore`. */
  snapshot: () => Promise<unknown>;
  restore: (snapshot: unknown) => Promise<void>;
}

export interface KeyEvent {
  vk: number;
  scan: number;
  flags: number;
}

/** The key events of one source character (none for characters that are not typed). */
export interface KeyGroup {
  events: KeyEvent[];
  /** UTF-16 code units of the text that this group stands for. */
  chars: number;
}

function keyPress(vk: number, scan: number): KeyEvent[] {
  return [
    { vk, scan, flags: 0 },
    { vk, scan, flags: KEYEVENTF_KEYUP },
  ];
}

function unicodePress(unit: number): KeyEvent[] {
  return [
    { vk: 0, scan: unit, flags: KEYEVENTF_UNICODE },
    { vk: 0, scan: unit, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
  ];
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** Splits text into the key presses that type it. */
export function textToKeyGroups(text: string): KeyGroup[] {
  const groups: KeyGroup[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0x0d || unit === 0x0a) {
      const pair = unit === 0x0d && text.charCodeAt(index + 1) === 0x0a;
      groups.push({ events: keyPress(VK_RETURN, SCAN_RETURN), chars: pair ? 2 : 1 });
      if (pair) index += 1;
    } else if (unit === 0x09) {
      groups.push({ events: keyPress(VK_TAB, SCAN_TAB), chars: 1 });
    } else if (unit < 0x20 || unit === 0x7f || isLowSurrogate(unit)) {
      groups.push({ events: [], chars: 1 });
    } else if (isHighSurrogate(unit)) {
      const low = text.charCodeAt(index + 1);
      if (isLowSurrogate(low)) {
        groups.push({ events: [...unicodePress(unit), ...unicodePress(low)], chars: 2 });
        index += 1;
      } else {
        groups.push({ events: [], chars: 1 });
      }
    } else {
      groups.push({ events: unicodePress(unit), chars: 1 });
    }
  }
  return groups;
}

/** The INPUT array SendInput expects: keyboard events of 40 bytes each. */
export function encodeEvents(events: readonly KeyEvent[]): Buffer {
  const buffer = Buffer.alloc(events.length * INPUT_SIZE);
  events.forEach((event, index) => {
    const offset = index * INPUT_SIZE;
    buffer.writeUInt32LE(INPUT_KEYBOARD, offset);
    buffer.writeUInt16LE(event.vk, offset + 8);
    buffer.writeUInt16LE(event.scan, offset + 10);
    buffer.writeUInt32LE(event.flags, offset + 12);
  });
  return buffer;
}

export type InjectFailure = 'keys-held' | 'refused' | 'interrupted';

export type InjectOutcome =
  | { status: 'ok' }
  | {
      status: 'failed';
      reason: InjectFailure;
      /** UTF-16 code units of the text that were delivered before the failure. */
      typed: number;
    };

export interface TypeOptions {
  /** Asked before every batch; false stops typing (the user switched to another window). */
  shouldContinue?: () => boolean;
}

export interface InputInjector {
  typeText(text: string, options?: TypeOptions): Promise<InjectOutcome>;
  pasteText(text: string): Promise<InjectOutcome>;
  /** Puts back a clipboard that is still waiting to be restored. */
  dispose(): void;
}

export interface InjectorDeps {
  win32: Win32Input;
  clipboard: ClipboardPort;
  sleep?: (ms: number) => Promise<void>;
  /** Runs `run` after `ms`; returns the function that cancels it. */
  schedule?: (run: () => void, ms: number) => () => void;
  batchPauseMs?: number;
  modifierPollMs?: number;
  modifierTimeoutMs?: number;
  restoreDelayMs?: number;
}

const OK: InjectOutcome = { status: 'ok' };
const failed = (reason: InjectFailure, typed: number): InjectOutcome => ({
  status: 'failed',
  reason,
  typed,
});

const CTRL_DOWN: KeyEvent = { vk: VK_CONTROL, scan: SCAN_CONTROL, flags: 0 };
const CTRL_UP: KeyEvent = { ...CTRL_DOWN, flags: KEYEVENTF_KEYUP };
const PASTE_KEYS: readonly KeyEvent[] = [CTRL_DOWN, ...keyPress(VK_V, SCAN_V), CTRL_UP];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/** Characters of the groups whose events were all accepted. */
function deliveredChars(batch: readonly KeyGroup[], accepted: number): number {
  let remaining = accepted;
  let chars = 0;
  for (const group of batch) {
    if (group.events.length > remaining) break;
    remaining -= group.events.length;
    chars += group.chars;
  }
  return chars;
}

export function createInputInjector(deps: InjectorDeps): InputInjector {
  const { win32, clipboard } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const schedule = deps.schedule ?? defaultSchedule;
  const batchPauseMs = deps.batchPauseMs ?? BATCH_PAUSE_MS;
  const modifierPollMs = deps.modifierPollMs ?? MODIFIER_POLL_MS;
  const modifierTimeoutMs = deps.modifierTimeoutMs ?? MODIFIER_TIMEOUT_MS;
  const restoreDelayMs = deps.restoreDelayMs ?? PASTE_RESTORE_MS;
  const pendingRestores = new Set<{ cancel: () => void; restore: () => Promise<void> }>();

  const modifierDown = (): boolean =>
    MODIFIERS.some((key) => (win32.getAsyncKeyState(key) & 0x8000) !== 0);

  /** Shift, Ctrl, Alt or Win still held (the hotkey) would turn typing into shortcuts. */
  async function modifiersReleased(): Promise<boolean> {
    for (let waited = 0; modifierDown(); waited += modifierPollMs) {
      if (waited >= modifierTimeoutMs) return false;
      await sleep(modifierPollMs);
    }
    return true;
  }

  const send = (events: readonly KeyEvent[]): number =>
    win32.sendInput(events.length, encodeEvents(events), INPUT_SIZE);

  function scheduleRestore(transcript: string, snapshot: unknown): void {
    const restore = async (): Promise<void> => {
      try {
        // Only when the clipboard still holds the transcript: the user may have copied since.
        if ((await clipboard.readText()) === transcript) await clipboard.restore(snapshot);
      } catch {
        // Best effort: the clipboard may be locked by another app.
      }
    };
    const entry = {
      cancel: schedule(() => {
        pendingRestores.delete(entry);
        void restore();
      }, restoreDelayMs),
      restore,
    };
    pendingRestores.add(entry);
  }

  return {
    async typeText(text, options = {}) {
      const groups = textToKeyGroups(text);
      if (!groups.some((group) => group.events.length > 0)) return OK;
      if (!(await modifiersReleased())) return failed('keys-held', 0);

      let typed = 0;
      let batch: KeyGroup[] = [];
      let batchEvents = 0;

      const flush = (): InjectOutcome | null => {
        if (options.shouldContinue && !options.shouldContinue()) {
          return failed('interrupted', typed);
        }
        const events = batch.flatMap((group) => group.events);
        const accepted = events.length === 0 ? 0 : send(events);
        if (accepted < events.length) {
          return failed('refused', typed + deliveredChars(batch, accepted));
        }
        typed += batch.reduce((total, group) => total + group.chars, 0);
        batch = [];
        batchEvents = 0;
        return null;
      };

      for (const group of groups) {
        if (batchEvents + group.events.length > MAX_BATCH_EVENTS) {
          const failure = flush();
          if (failure) return failure;
          await sleep(batchPauseMs);
        }
        batch.push(group);
        batchEvents += group.events.length;
      }
      return flush() ?? OK;
    },

    async pasteText(text) {
      if (text === '') return OK;
      if (!(await modifiersReleased())) return failed('keys-held', 0);

      let snapshot: unknown;
      let restorable = true;
      try {
        snapshot = await clipboard.snapshot();
      } catch {
        restorable = false;
      }
      await clipboard.writeText(text);

      const accepted = send(PASTE_KEYS);
      if (accepted < PASTE_KEYS.length) {
        // Never leave Ctrl pressed; the transcript stays on the clipboard for the user.
        if (accepted > 0) send([CTRL_UP]);
        return failed('refused', 0);
      }
      if (restorable) scheduleRestore(text, snapshot);
      return OK;
    },

    dispose() {
      for (const entry of [...pendingRestores]) {
        entry.cancel();
        pendingRestores.delete(entry);
        void entry.restore();
      }
    },
  };
}

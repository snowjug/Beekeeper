import { describe, expect, it, vi } from 'vitest';
import {
  bindWin32Input,
  createInputInjector,
  encodeEvents,
  INPUT_SIZE,
  textToKeyGroups,
  type ClipboardPort,
  type InjectorDeps,
  type Win32Input,
} from '@main/system/inputInjector';
import type { KoffiLike } from '@main/system/win32';

const KEYUP = 0x0002;
const UNICODE = 0x0004;

interface Sent {
  count: number;
  bytes: Buffer;
}

function setup(
  options: {
    /** How many of the events of call number `call` (1-based) Windows accepts. */
    accept?: (count: number, call: number) => number;
    /** Values GetAsyncKeyState returns on successive polls (the last one repeats). */
    keyStates?: number[];
    clipboardText?: string;
    snapshot?: () => Promise<unknown>;
    restoreDelayMs?: number;
  } = {},
) {
  const sent: Sent[] = [];
  const sendInput = vi.fn<Win32Input['sendInput']>((count, bytes) => {
    sent.push({ count, bytes: Buffer.from(bytes) });
    return options.accept ? options.accept(count, sent.length) : count;
  });
  const states = options.keyStates ?? [0];
  let poll = 0;
  const getAsyncKeyState = vi.fn<Win32Input['getAsyncKeyState']>(() => {
    const value = states[Math.min(poll, states.length - 1)] ?? 0;
    return value;
  });
  const win32: Win32Input = { sendInput, getAsyncKeyState };

  let clipboardText = options.clipboardText ?? 'old clipboard';
  const writeText = vi.fn((text: string) => {
    clipboardText = text;
    return Promise.resolve();
  });
  const restore = vi.fn((_snapshot: unknown) => Promise.resolve());
  const clipboard: ClipboardPort = {
    readText: () => Promise.resolve(clipboardText),
    writeText,
    snapshot: options.snapshot ?? (() => Promise.resolve({ saved: 'old clipboard' })),
    restore,
  };

  const sleeps: number[] = [];
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const deps: InjectorDeps = {
    win32,
    clipboard,
    sleep: (ms) => {
      sleeps.push(ms);
      poll += 1;
      return Promise.resolve();
    },
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    ...(options.restoreDelayMs === undefined ? {} : { restoreDelayMs: options.restoreDelayMs }),
  };
  return {
    injector: createInputInjector(deps),
    sent,
    sendInput,
    getAsyncKeyState,
    writeText,
    restore,
    sleeps,
    timers,
    setClipboard: (text: string) => {
      clipboardText = text;
    },
  };
}

/** Decodes the INPUT array of one SendInput call. */
function decode(bytes: Buffer): Array<{ type: number; vk: number; scan: number; flags: number }> {
  const events: Array<{ type: number; vk: number; scan: number; flags: number }> = [];
  for (let offset = 0; offset < bytes.length; offset += INPUT_SIZE) {
    events.push({
      type: bytes.readUInt32LE(offset),
      vk: bytes.readUInt16LE(offset + 8),
      scan: bytes.readUInt16LE(offset + 10),
      flags: bytes.readUInt32LE(offset + 12),
    });
  }
  return events;
}

/** The characters a sequence of Unicode key presses types (key-downs only). */
function typedText(calls: readonly Sent[]): string {
  return calls
    .flatMap((call) => decode(call.bytes))
    .filter((event) => event.flags === UNICODE)
    .map((event) => String.fromCharCode(event.scan))
    .join('');
}

describe('textToKeyGroups', () => {
  it('presses and releases a Unicode key for every character', () => {
    const groups = textToKeyGroups('Hi');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      events: [
        { vk: 0, scan: 0x48, flags: UNICODE },
        { vk: 0, scan: 0x48, flags: UNICODE | KEYUP },
      ],
      chars: 1,
    });
  });

  it('types Devanagari one code unit at a time', () => {
    const groups = textToKeyGroups('नमस्ते');
    expect(groups.map((group) => group.chars)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(groups[0]?.events[0]?.scan).toBe('न'.charCodeAt(0));
  });

  it('keeps both halves of a surrogate pair together', () => {
    const groups = textToKeyGroups('😀');
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group?.chars).toBe(2);
    expect(group?.events.map((event) => event.scan)).toEqual([0xd83d, 0xd83d, 0xde00, 0xde00]);
  });

  it('presses Enter for line breaks and Tab for tabs', () => {
    const [enter, crlf, tab] = textToKeyGroups('\n\r\n\t');
    expect(enter?.events[0]).toEqual({ vk: 0x0d, scan: 0x1c, flags: 0 });
    expect(enter?.events[1]?.flags).toBe(KEYUP);
    expect(crlf?.chars).toBe(2);
    expect(crlf?.events[0]?.vk).toBe(0x0d);
    expect(tab?.events[0]).toEqual({ vk: 0x09, scan: 0x0f, flags: 0 });
  });

  it('skips control characters and lone surrogates but still counts them', () => {
    const groups = textToKeyGroups('a\u0007b\ud83dc\ude00');
    expect(groups.map((group) => [group.events.length, group.chars])).toEqual([
      [2, 1],
      [0, 1],
      [2, 1],
      [0, 1],
      [2, 1],
      [0, 1],
    ]);
  });
});

describe('encodeEvents', () => {
  it('writes 40-byte keyboard INPUT structures', () => {
    const bytes = encodeEvents([
      { vk: 0, scan: 0x0928, flags: UNICODE },
      { vk: 0x11, scan: 0x1d, flags: KEYUP },
    ]);
    expect(bytes.length).toBe(2 * INPUT_SIZE);
    expect(bytes.readUInt32LE(0)).toBe(1);
    expect(bytes.readUInt16LE(8)).toBe(0);
    expect(bytes.readUInt16LE(10)).toBe(0x0928);
    expect(bytes.readUInt32LE(12)).toBe(UNICODE);
    expect(bytes.readUInt32LE(16)).toBe(0);
    expect(bytes.readBigUInt64LE(24)).toBe(0n);
    expect(bytes.readUInt32LE(INPUT_SIZE)).toBe(1);
    expect(bytes.readUInt16LE(INPUT_SIZE + 8)).toBe(0x11);
    expect(bytes.readUInt32LE(INPUT_SIZE + 12)).toBe(KEYUP);
  });
});

describe('typeText', () => {
  it('sends one batch for a short text', async () => {
    const { injector, sent } = setup();
    await expect(injector.typeText('Hello, नमस्ते')).resolves.toEqual({ status: 'ok' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.count).toBe(2 * 'Hello, नमस्ते'.length);
    expect(typedText(sent)).toBe('Hello, नमस्ते');
  });

  it('does nothing for an empty text or one without printable characters', async () => {
    const { injector, sendInput } = setup();
    await expect(injector.typeText('')).resolves.toEqual({ status: 'ok' });
    await expect(injector.typeText('\u0007')).resolves.toEqual({ status: 'ok' });
    expect(sendInput).not.toHaveBeenCalled();
  });

  it('splits long text into batches of at most 64 events with a pause between them', async () => {
    const text = 'x'.repeat(100);
    const { injector, sent, sleeps } = setup();
    await injector.typeText(text);
    expect(sent.map((call) => call.count)).toEqual([64, 64, 64, 8]);
    expect(typedText(sent)).toBe(text);
    // Only the pauses between batches (the key-state polling sleeps nothing here).
    expect(sleeps).toEqual([2, 2, 2]);
  });

  it('never splits a surrogate pair or a key press across batches', async () => {
    const text = `${'a'.repeat(31)}😀${'b'.repeat(3)}`;
    const { injector, sent } = setup();
    await injector.typeText(text);
    expect(sent.map((call) => call.count)).toEqual([62, 10]);
    const second = decode(sent[1]?.bytes ?? Buffer.alloc(0));
    expect(second.slice(0, 4).map((event) => event.scan)).toEqual([0xd83d, 0xd83d, 0xde00, 0xde00]);
    // Every key-down is followed by its key-up inside the same call.
    for (const call of sent) {
      const events = decode(call.bytes);
      for (let index = 0; index < events.length; index += 2) {
        expect(events[index]?.flags).toBe(UNICODE);
        expect(events[index + 1]?.flags).toBe(UNICODE | KEYUP);
      }
    }
  });

  it('types a line break and a tab as Enter and Tab', async () => {
    const { injector, sent } = setup();
    await injector.typeText('a\nb\tc');
    const events = decode(sent[0]?.bytes ?? Buffer.alloc(0));
    expect(events.map((event) => event.vk)).toEqual([0, 0, 0x0d, 0x0d, 0, 0, 0x09, 0x09, 0, 0]);
  });

  it('reports a refusal (UIPI: the target app is elevated) before anything was typed', async () => {
    const { injector, sendInput } = setup({ accept: () => 0 });
    await expect(injector.typeText('hello')).resolves.toEqual({
      status: 'failed',
      reason: 'refused',
      typed: 0,
    });
    expect(sendInput).toHaveBeenCalledTimes(1);
  });

  it('reports how much was typed when a later batch is refused', async () => {
    const { injector, sent } = setup({ accept: (count, call) => (call === 1 ? count : 0) });
    await expect(injector.typeText('x'.repeat(100))).resolves.toEqual({
      status: 'failed',
      reason: 'refused',
      typed: 32,
    });
    expect(sent).toHaveLength(2);
  });

  it('counts only whole characters when Windows accepts part of a batch', async () => {
    const { injector } = setup({ accept: (count) => count - 1 });
    await expect(injector.typeText('abc')).resolves.toEqual({
      status: 'failed',
      reason: 'refused',
      typed: 2,
    });
  });

  it('stops before the next batch when the caller says the focus moved', async () => {
    const decisions = [true, false];
    const shouldContinue = vi.fn(() => decisions.shift() ?? false);
    const { injector, sent } = setup();
    await expect(injector.typeText('x'.repeat(100), { shouldContinue })).resolves.toEqual({
      status: 'failed',
      reason: 'interrupted',
      typed: 32,
    });
    expect(sent).toHaveLength(1);
    expect(shouldContinue).toHaveBeenCalledTimes(2);
  });

  it('waits for the hotkey modifiers to be released before typing', async () => {
    const { injector, sent, getAsyncKeyState, sleeps } = setup({
      // Alt (0x12) is down for the first two key-state polls.
      keyStates: [-32768, -32768, 0],
    });
    const result = injector.typeText('ok');
    await expect(result).resolves.toEqual({ status: 'ok' });
    expect(sent).toHaveLength(1);
    expect(getAsyncKeyState).toHaveBeenCalled();
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((ms) => ms === 25)).toBe(true);
  });

  it('gives up and types nothing when a modifier stays down', async () => {
    const { injector, sendInput } = setup({ keyStates: [-32768] });
    await expect(injector.typeText('ok')).resolves.toEqual({
      status: 'failed',
      reason: 'keys-held',
      typed: 0,
    });
    expect(sendInput).not.toHaveBeenCalled();
  });
});

describe('pasteText', () => {
  it('puts the text on the clipboard and presses Ctrl+V', async () => {
    const { injector, sent, writeText } = setup();
    await expect(injector.pasteText('नमस्ते')).resolves.toEqual({ status: 'ok' });
    expect(writeText).toHaveBeenCalledWith('नमस्ते');
    expect(sent).toHaveLength(1);
    expect(
      decode(sent[0]?.bytes ?? Buffer.alloc(0)).map((event) => [event.vk, event.flags]),
    ).toEqual([
      [0x11, 0],
      [0x56, 0],
      [0x56, KEYUP],
      [0x11, KEYUP],
    ]);
  });

  it('puts the old clipboard back after a moment', async () => {
    const { injector, timers, restore } = setup({ restoreDelayMs: 500 });
    await injector.pasteText('transcript');
    expect(restore).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(500);

    timers[0]?.run();
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith({ saved: 'old clipboard' }));
  });

  it('leaves the clipboard alone when the user copied something else meanwhile', async () => {
    const { injector, timers, restore, setClipboard } = setup();
    await injector.pasteText('transcript');
    setClipboard('something the user copied');
    timers[0]?.run();
    await new Promise((done) => setTimeout(done, 0));
    expect(restore).not.toHaveBeenCalled();
  });

  it('does not touch the clipboard afterwards when it could not be saved', async () => {
    const { injector, timers } = setup({ snapshot: () => Promise.reject(new Error('locked')) });
    await expect(injector.pasteText('transcript')).resolves.toEqual({ status: 'ok' });
    expect(timers).toHaveLength(0);
  });

  it('reports a refusal and leaves the transcript on the clipboard', async () => {
    const { injector, writeText, timers } = setup({ accept: () => 0 });
    await expect(injector.pasteText('transcript')).resolves.toEqual({
      status: 'failed',
      reason: 'refused',
      typed: 0,
    });
    expect(writeText).toHaveBeenCalledWith('transcript');
    expect(timers).toHaveLength(0);
  });

  it('releases Ctrl when only part of the shortcut was accepted', async () => {
    const { injector, sent } = setup({ accept: (count, call) => (call === 1 ? 2 : count) });
    await expect(injector.pasteText('transcript')).resolves.toMatchObject({ status: 'failed' });
    expect(sent).toHaveLength(2);
    expect(
      decode(sent[1]?.bytes ?? Buffer.alloc(0)).map((event) => [event.vk, event.flags]),
    ).toEqual([[0x11, KEYUP]]);
  });

  it('does not paste while a hotkey modifier is held', async () => {
    const { injector, sendInput, writeText } = setup({ keyStates: [-32768] });
    await expect(injector.pasteText('transcript')).resolves.toMatchObject({
      reason: 'keys-held',
    });
    expect(sendInput).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('restores a pending clipboard at once when it is disposed', async () => {
    const { injector, timers, restore } = setup();
    await injector.pasteText('transcript');
    injector.dispose();
    expect(timers[0]?.cancelled).toBe(true);
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  });

  it('ignores an empty transcript', async () => {
    const { injector, sendInput } = setup();
    await expect(injector.pasteText('')).resolves.toEqual({ status: 'ok' });
    expect(sendInput).not.toHaveBeenCalled();
  });
});

describe('bindWin32Input', () => {
  it('declares SendInput with the INPUT array as a pointer and the key state reader', () => {
    const declared: string[] = [];
    const koffi: KoffiLike = {
      load: (library) => ({
        func: (definition) => {
          declared.push(`${library}:${definition}`);
          return vi.fn();
        },
      }),
    };
    const input = bindWin32Input(koffi);
    expect(declared).toEqual([
      'user32.dll:uint32 SendInput(uint32 cInputs, void *pInputs, int cbSize)',
      'user32.dll:int16 GetAsyncKeyState(int vKey)',
    ]);
    expect(typeof input.sendInput).toBe('function');
  });
});

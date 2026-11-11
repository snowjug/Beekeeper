import { execFile } from 'node:child_process';
import { test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import koffi from 'koffi';
import { expect, launchApp, speechWav } from './fixtures';

/**
 * Dictation anywhere, end to end, with real input: a stand-in for Notepad (a window with a text
 * box) has the keyboard focus, the dictation starts, the fake microphone "speaks" and Windows
 * SendInput types the transcript into the text box. Only the speech recognizer is replaced by a
 * stub (no model is installed on the test machine). Like the hotkey tests they need an
 * interactive, unlocked desktop: when Windows will not hand the test window the keyboard focus,
 * or refuses the key press, they report themselves as skipped (and never type into another app).
 */

interface Hooks {
  __beekeeper: {
    features: {
      speech: { transcribe: (request: { samples: Float32Array }) => Promise<unknown> };
      dictation: { toggle: (source: string) => void; active: boolean; phase: string };
    };
  };
  __dictationSamples?: number[];
  __answer?: () => void;
}

const TRANSCRIPT = 'hello comma नमस्ते दुनिया full stop new line second line';
const TYPED = 'Hello, नमस्ते दुनिया।\nSecond line';

const user32 = koffi.load('user32.dll');
const getForegroundWindow = user32.func('intptr_t GetForegroundWindow()') as () => number;
const setForegroundWindow = user32.func('int SetForegroundWindow(intptr_t hWnd)') as (
  handle: number,
) => number;
const keybdEvent = user32.func(
  'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)',
) as (key: number, scan: number, flags: number, extra: number) => void;
const getWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32 *lpdwProcessId)',
) as (handle: number, processId: number[]) => number;

const VK_MENU = 0x12;
const KEYEVENTF_KEYUP = 0x2;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * `handle` must still have the keyboard focus. When an unrelated app took it meanwhile (the
 * desktop is shared) nothing can be said about dictation, so the test is skipped; a window of
 * the app under test holding the focus is a failure.
 */
function expectForeground(app: ElectronApplication, handle: number): void {
  const current = getForegroundWindow();
  if (current !== handle) {
    const owner = [0];
    getWindowThreadProcessId(current, owner);
    test.skip(owner[0] !== app.process().pid, 'Another app took the keyboard focus meanwhile');
  }
  expect(current).toBe(handle);
}

/** Makes `handle` the window that really has the keyboard focus; false when Windows refuses. */
async function takeForeground(handle: number): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt >= 2) {
      // A synthetic Alt press makes the calling process eligible to change the foreground.
      keybdEvent(VK_MENU, 0, 0, 0);
      keybdEvent(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
    }
    setForegroundWindow(handle);
    await sleep(150);
    if (getForegroundWindow() === handle) return true;
  }
  return false;
}

/** A window with a text box has the keyboard focus (like Notepad, Word or Chrome would). */
async function openTarget(app: ElectronApplication): Promise<{ page: Page; handle: number }> {
  const handle = await app.evaluate(async ({ BrowserWindow }) => {
    const html =
      '<title>Dictation target</title><body style="margin:0"><textarea id="t" autofocus style="width:100%;height:100vh;font-size:20px"></textarea></body>';
    const win = new BrowserWindow({ width: 560, height: 280, x: 80, y: 80, show: true });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.show();
    win.focus();
    return win.getNativeWindowHandle().readUInt32LE(0);
  });

  if (!(await takeForeground(handle))) {
    test.skip(true, 'Windows did not give the test window the keyboard focus (locked session?)');
  }
  const deadline = Date.now() + 10_000;
  for (;;) {
    const page = app.windows().find((candidate) => candidate.url().startsWith('data:text/html'));
    if (page) {
      await page.locator('#t').focus();
      return { page, handle };
    }
    if (Date.now() > deadline) throw new Error('The dictation target page did not load');
    await sleep(100);
  }
}

/** Replaces the speech recognizer and records the length of the audio it was given. */
async function stubRecognizer(app: ElectronApplication, text: string | null): Promise<void> {
  await app.evaluate((_electron, transcript) => {
    const hooks = globalThis as unknown as Hooks;
    hooks.__dictationSamples = [];
    hooks.__beekeeper.features.speech.transcribe = (request) => {
      hooks.__dictationSamples?.push(request.samples.length);
      if (transcript === null) return Promise.reject(new Error('This must not be called.'));
      return Promise.resolve({
        text: transcript,
        lang: 'hi',
        model: 'small',
        durationMs: 5,
        audioMs: Math.round(request.samples.length / 16),
      });
    };
  }, text);
}

const toggleDictation = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => {
    (globalThis as unknown as Hooks).__beekeeper.features.dictation.toggle('hotkey');
  });

const dictationState = (app: ElectronApplication): Promise<{ phase: string; active: boolean }> =>
  app.evaluate(() => {
    const { dictation } = (globalThis as unknown as Hooks).__beekeeper.features;
    return { phase: dictation.phase, active: dictation.active };
  });

const pillVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (win) => win.webContents.getURL().includes('/dictation/') && win.isVisible(),
    ),
  );

const recognizerCalls = (app: ElectronApplication): Promise<number[]> =>
  app.evaluate(() => (globalThis as unknown as Hooks).__dictationSamples ?? []);

/** Like the stub above, but the answer is only given when the test says so (`answerRecognizer`). */
async function stubSlowRecognizer(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate((_electron, transcript) => {
    const hooks = globalThis as unknown as Hooks;
    hooks.__dictationSamples = [];
    hooks.__beekeeper.features.speech.transcribe = (request) =>
      new Promise((resolve) => {
        hooks.__dictationSamples?.push(request.samples.length);
        hooks.__answer = () =>
          resolve({
            text: transcript,
            lang: 'hi',
            model: 'small',
            durationMs: 5,
            audioMs: Math.round(request.samples.length / 16),
          });
      });
  }, text);
}

const answerRecognizer = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => {
    (globalThis as unknown as Hooks).__answer?.();
  });

const clipboardText = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText());

/** A second window, standing for "another app" the user switches to. */
const openOtherApp = (app: ElectronApplication): Promise<number> =>
  app.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({ width: 320, height: 200, x: 700, y: 80, show: true });
    await win.loadURL('data:text/plain;charset=utf-8,another%20app');
    return win.getNativeWindowHandle().readUInt32LE(0);
  });

/** What one line of the pill window says right now ('' while it is not there). */
async function pillText(app: ElectronApplication, testId: string): Promise<string> {
  const pill = app.windows().find((candidate) => candidate.url().includes('/dictation/'));
  if (!pill) return '';
  const text = await pill
    .getByTestId(testId)
    .textContent({ timeout: 1000 })
    .catch(() => '');
  return text ?? '';
}

/**
 * Real key presses (SendKeys goes through the Windows input queue). With `again` the same keys
 * are pressed a second time after that pause by the same process, so the pause does not depend
 * on how long PowerShell takes to start.
 */
function press(keys: string, again?: { afterMs: number }): Promise<void> {
  const send = `[System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
  const second = again ? `; Start-Sleep -Milliseconds ${again.afterMs}; ${send}` : '';
  const script = `Add-Type -AssemblyName System.Windows.Forms; ${send}${second}`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30_000 + (again?.afterMs ?? 0) },
      (error, _stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(),
    );
  });
}

/** Presses keys, or skips the test when Windows does not accept synthetic input right now. */
async function pressOrSkip(keys: string, again?: { afterMs: number }): Promise<void> {
  try {
    await press(keys, again);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    test.skip(/access is denied/i.test(message), 'The desktop is locked: no key presses');
    throw error;
  }
}

test.describe('dictation anywhere', () => {
  test.setTimeout(120_000);
  // The tests type through the real input queue, which anyone using the desktop shares.
  test.describe.configure({ retries: 1 });

  test('types the transcript into the app that has the focus and hides the pill', async () => {
    const launched = await launchApp({
      fakeMic: speechWav('hello world'),
      settings: { dictation: { silenceSeconds: 0.8 } },
    });
    try {
      const { app } = launched;
      const { page, handle } = await openTarget(app);
      await stubRecognizer(app, TRANSCRIPT);

      await toggleDictation(app);
      await expect.poll(() => pillVisible(app), { timeout: 20_000 }).toBe(true);
      // The pill is shown without taking the keyboard focus from the app being dictated into.
      expectForeground(app, handle);

      // The fake microphone says "hello world"; the silence after it ends the dictation.
      await expect.poll(() => page.locator('#t').inputValue(), { timeout: 60_000 }).toBe(TYPED);
      expectForeground(app, handle);

      const samples = await recognizerCalls(app);
      expect(samples).toHaveLength(1);
      // Real speech with some context; how much of the start was heard depends on how fast the
      // microphone opened on this machine.
      expect(samples[0]).toBeGreaterThan(3_200);

      await expect.poll(() => pillVisible(app), { timeout: 10_000 }).toBe(false);
      await expect
        .poll(() => dictationState(app), { timeout: 10_000 })
        .toEqual({ phase: 'idle', active: false });
    } finally {
      await launched.close();
    }
  });

  test('Esc cancels a running dictation and nothing is recognised or typed (real key press)', async () => {
    const launched = await launchApp({
      fakeMic: speechWav('hello world'),
      // Long enough that the dictation is still listening when Esc is pressed.
      settings: { dictation: { silenceSeconds: 8 } },
    });
    try {
      const { app } = launched;
      // Proves that the desktop is unlocked and accepts input; Esc is pressed for real below.
      const { page } = await openTarget(app);
      // The recognizer refuses to run: if Esc did not cancel, nothing could be typed anyway.
      await stubRecognizer(app, null);

      await toggleDictation(app);
      await expect.poll(() => pillVisible(app), { timeout: 20_000 }).toBe(true);
      // Esc is a global shortcut only while a dictation can be cancelled.
      const escapeRegistered = (): Promise<boolean> =>
        app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Escape'));
      await expect.poll(escapeRegistered, { timeout: 10_000 }).toBe(true);

      await pressOrSkip('{ESC}');

      await expect.poll(() => pillVisible(app), { timeout: 10_000 }).toBe(false);
      await expect.poll(escapeRegistered, { timeout: 10_000 }).toBe(false);
      await expect
        .poll(() => dictationState(app), { timeout: 10_000 })
        .toEqual({ phase: 'idle', active: false });
      expect(await recognizerCalls(app)).toEqual([]);
      expect(await page.locator('#t').inputValue()).toBe('');
    } finally {
      await launched.close();
    }
  });

  test('paste mode types through the clipboard and then gives the old clipboard back', async () => {
    const launched = await launchApp({
      fakeMic: speechWav('hello world'),
      settings: { dictation: { method: 'paste', silenceSeconds: 0.8 } },
    });
    try {
      const { app } = launched;
      const { page } = await openTarget(app);
      await app.evaluate(({ clipboard }) => clipboard.writeText('what I copied earlier'));
      await stubRecognizer(app, TRANSCRIPT);

      await toggleDictation(app);
      await expect.poll(() => page.locator('#t').inputValue(), { timeout: 60_000 }).toBe(TYPED);
      await expect
        .poll(() => clipboardText(app), { timeout: 10_000 })
        .toBe('what I copied earlier');
      await expect.poll(() => pillVisible(app), { timeout: 10_000 }).toBe(false);
    } finally {
      await launched.close();
    }
  });

  test('does not type into another app when the focus moved: the text goes to the clipboard', async () => {
    const launched = await launchApp({
      fakeMic: speechWav('hello world'),
      settings: { dictation: { silenceSeconds: 0.8 } },
    });
    try {
      const { app } = launched;
      const otherApp = await openOtherApp(app);
      const { page, handle } = await openTarget(app);
      await app.evaluate(({ clipboard }) => clipboard.writeText('what I copied earlier'));
      await stubSlowRecognizer(app, TRANSCRIPT);

      await toggleDictation(app);
      await expect.poll(() => recognizerCalls(app), { timeout: 60_000 }).toHaveLength(1);
      expectForeground(app, handle);

      // The user switches to another app while the speech is being recognised.
      if (!(await takeForeground(otherApp))) {
        test.skip(true, 'Windows would not move the keyboard focus to the other window');
      }
      await answerRecognizer(app);

      await expect.poll(() => clipboardText(app), { timeout: 10_000 }).toBe(TYPED);
      await expect
        .poll(() => pillText(app, 'pill-title'), { timeout: 5000, intervals: [50] })
        .toBe('Copied — press Ctrl+V');
      expect(await page.locator('#t').inputValue()).toBe('');
      expectForeground(app, otherApp);

      await expect.poll(() => pillVisible(app), { timeout: 10_000 }).toBe(false);
      await expect
        .poll(() => dictationState(app), { timeout: 10_000 })
        .toEqual({ phase: 'idle', active: false });
    } finally {
      await launched.close();
    }
  });

  test('Alt+Shift+D starts a dictation and the second press finishes it (real key presses)', async () => {
    const launched = await launchApp({
      fakeMic: speechWav('hello world'),
      // The longest pause the setting allows: only the second key press can end the dictation.
      settings: { dictation: { silenceSeconds: 8 } },
    });
    try {
      const { app } = launched;
      const registered = await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered('Alt+Shift+D'),
      );
      test.skip(!registered, 'Alt+Shift+D is held by another app');
      const { page, handle } = await openTarget(app);
      await stubRecognizer(app, TRANSCRIPT);

      // % = Alt, + = Shift. Six seconds apart: the fake microphone (2.4 s of audio) has said its
      // piece by then, and the 8 s of silence that would end the dictation on its own are not over.
      const pressing = pressOrSkip('%+d', { afterMs: 6000 });
      // A failed key press is reported where it is awaited below.
      pressing.catch(() => undefined);

      await expect.poll(() => pillVisible(app), { timeout: 20_000 }).toBe(true);
      await expect
        .poll(() => pillText(app, 'pill-subtitle'), { timeout: 5000 })
        .toContain('Press Alt+Shift+D to finish');
      expectForeground(app, handle);

      await pressing;
      await expect.poll(() => page.locator('#t').inputValue(), { timeout: 30_000 }).toBe(TYPED);
      await expect.poll(() => pillVisible(app), { timeout: 10_000 }).toBe(false);
    } finally {
      await launched.close();
    }
  });
});

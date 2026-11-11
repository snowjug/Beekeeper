import { execFile } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';
import { expect, launchApp, pageFor, test } from './fixtures';

/**
 * Real OS-level key presses (SendKeys goes through the Windows input queue), so the global
 * shortcuts themselves are exercised: RegisterHotKey -> main process -> window. They need an
 * interactive, unlocked desktop; on a locked session Windows refuses the input ("Access is
 * denied") and those two tests report themselves as skipped.
 */
function press(keys: string): Promise<void> {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20_000 },
      (error, _stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(),
    );
  });
}

/** Presses keys, or skips the test when Windows does not accept synthetic input right now. */
async function pressOrSkip(keys: string): Promise<void> {
  try {
    await press(keys);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    test.skip(
      /access is denied/i.test(message),
      'The desktop is locked: Windows rejects key presses',
    );
    throw error;
  }
}

async function windowVisible(app: ElectronApplication, role: string): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, part) => {
    return BrowserWindow.getAllWindows().some(
      (win) => win.webContents.getURL().includes(`/${part}/`) && win.isVisible(),
    );
  }, role);
}

test.describe('global hotkeys', () => {
  test.setTimeout(120_000);

  test('both shortcuts are registered with Windows', async () => {
    const launched = await launchApp();
    try {
      await pageFor(launched.app, 'assistant');
      const registered = await launched.app.evaluate(({ globalShortcut }) => ({
        assistant: globalShortcut.isRegistered('Control+Shift+Space'),
        circle: globalShortcut.isRegistered('Alt+Shift+C'),
      }));
      expect(registered).toEqual({ assistant: true, circle: true });
    } finally {
      await launched.close();
    }
  });

  test('Ctrl+Shift+Space toggles the assistant bar (real key presses)', async () => {
    const launched = await launchApp();
    try {
      await pageFor(launched.app, 'assistant');
      await new Promise((done) => setTimeout(done, 1500));
      expect(await windowVisible(launched.app, 'assistant')).toBe(false);

      // ^ = Ctrl, + = Shift, ( ) = a space
      await pressOrSkip('^+( )');
      await expect
        .poll(() => windowVisible(launched.app, 'assistant'), { timeout: 5_000 })
        .toBe(true);
      const page = await pageFor(launched.app, 'assistant');
      await expect(page.getByRole('dialog', { name: 'Beekeeper assistant' })).toBeVisible();

      await press('^+( )');
      await expect
        .poll(() => windowVisible(launched.app, 'assistant'), { timeout: 5_000 })
        .toBe(false);
    } finally {
      await launched.close();
    }
  });

  test('Alt+Shift+C opens Circle to Search on the real screen and Esc cleans up (real key presses)', async () => {
    const launched = await launchApp();
    try {
      await pageFor(launched.app, 'assistant');
      await new Promise((done) => setTimeout(done, 1500));

      // % = Alt, + = Shift
      await pressOrSkip('%+c');
      await expect
        .poll(() => windowVisible(launched.app, 'circle'), { timeout: 10_000 })
        .toBe(true);
      const overlay = await pageFor(launched.app, 'circle');
      await expect(overlay.getByTestId('circle-overlay')).toBeVisible();

      await overlay.keyboard.press('Escape');
      await expect
        .poll(() => windowVisible(launched.app, 'circle'), { timeout: 5_000 })
        .toBe(false);
    } finally {
      await launched.close();
    }
  });
});

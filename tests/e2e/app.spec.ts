import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, openAssistant, projectRoot, test } from './fixtures';

const electronPath = createRequire(__filename)('electron') as unknown as string;

test.describe('application shell', () => {
  test('starts in the tray with the right icon and tooltip', async ({ launched }) => {
    const tray = await launched.app.evaluate(() => {
      const hooks = (
        globalThis as unknown as {
          __beekeeper: {
            ctx: {
              tray: { snapshot: () => { created: boolean; iconMissing: boolean; tooltip: string } };
            };
          };
        }
      ).__beekeeper;
      return hooks.ctx.tray.snapshot();
    });
    expect(tray.created).toBe(true);
    expect(tray.iconMissing).toBe(false);
    expect(tray.tooltip).toContain('Beekeeper 1.0.0');
    expect(tray.tooltip).toContain('Ctrl+Shift+Space');
  });

  test('a second launch quits and asks the running instance to show itself', async ({
    launched,
  }) => {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = execFile(
        electronPath,
        [projectRoot],
        {
          cwd: projectRoot,
          windowsHide: true,
          timeout: 30_000,
          env: {
            ...process.env,
            BEEKEEPER_E2E: '1',
            BEEKEEPER_USER_DATA: launched.userData,
          },
        },
        (error) => {
          if (error && typeof error.code !== 'number') reject(new Error(error.message));
        },
      );
      child.on('exit', (code) => resolve(code));
    });
    expect(exitCode).toBe(0);

    const visible = await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (win) => win.webContents.getURL().includes('/assistant/') && win.isVisible(),
      ),
    );
    expect(visible).toBe(true);
  });

  test('a 1 second timer fires a notification event and shows the "done" card', async ({
    launched,
  }) => {
    await launched.app.evaluate(() => {
      const hooks = (
        globalThis as unknown as {
          __beekeeper: {
            ctx: { timers: { onFire: (listener: (record: unknown) => void) => void } };
          };
        }
      ).__beekeeper;
      const fired: unknown[] = [];
      (globalThis as unknown as { __fired: unknown[] }).__fired = fired;
      hooks.ctx.timers.onFire((record) => fired.push(record));
    });

    const page = await openAssistant(launched.app);
    const input = page.getByRole('textbox', { name: 'Ask Beekeeper' });
    await input.fill('set a timer for 1 second');
    await input.press('Enter');
    await expect(page.locator('[data-card-kind="timer"]')).toBeVisible();

    await expect
      .poll(
        () =>
          launched.app.evaluate(
            () => (globalThis as unknown as { __fired: unknown[] }).__fired.length,
          ),
        { timeout: 10_000 },
      )
      .toBe(1);
    // The running countdown card is replaced by the "Time's up" card (the old one animates out).
    const done = page.locator('[data-card-kind="timer"]', { hasText: /time'?s up|done/i });
    await expect(done).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-card-kind="timer"]')).toHaveCount(1);
  });
});

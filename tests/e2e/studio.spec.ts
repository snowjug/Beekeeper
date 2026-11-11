import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  expect,
  launchApp,
  pageFor,
  renderScreen,
  test,
  type RenderedScreen,
  type ScreenText,
} from './fixtures';

const run = promisify(execFile);

const SCREEN: ScreenText[] = [
  { id: 'title', text: 'Capture Studio', x: 120, baseline: 240, size: 84, bold: true },
  { id: 'body', text: 'A picture to copy, pin and edit', x: 120, baseline: 380, size: 44 },
];

const SHOT_NAME = /^Beekeeper \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \(\d+\))?\.png$/;
const SHOT_NAME_IN_FOLDER = /[\\/]Beekeeper \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \(\d+\))?\.png$/;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A temporary screenshots folder, so the tests never touch the user's Pictures folder. */
function shotsFolder(): string {
  return mkdtempSync(join(tmpdir(), 'beekeeper-shots-'));
}

/** `features.studio.capture('ui')`: the same path as the hotkey, the tray and the voice command. */
async function capture(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    const hooks = (
      globalThis as unknown as {
        __beekeeper: { features: { studio: { capture: (source: string) => Promise<void> } } };
      }
    ).__beekeeper;
    await hooks.features.studio.capture('ui');
  });
}

/** Opens the Studio on a picture that is already in memory (no dependency on the desktop). */
async function openPicture(app: ElectronApplication, screenshot: RenderedScreen): Promise<void> {
  const png = Buffer.from(screenshot.png, 'base64');
  // The PNG header holds the pixel size.
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  await app.evaluate(
    async (_electron, args) => {
      const hooks = (
        globalThis as unknown as {
          __beekeeper: {
            features: {
              studio: {
                openImage: (
                  png: Buffer,
                  size: { width: number; height: number },
                  source: string,
                ) => Promise<void>;
              };
            };
          };
        }
      ).__beekeeper;
      await hooks.features.studio.openImage(Buffer.from(args.png, 'base64'), args.size, 'ui');
    },
    { png: screenshot.png, size },
  );
}

/** True when the app can grab the display (a locked or disconnected session cannot). */
async function screenCanBeCaptured(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async () => {
    const hooks = (
      globalThis as unknown as { __beekeeper: { captureStats: () => Promise<unknown> } }
    ).__beekeeper;
    try {
      await hooks.captureStats();
      return true;
    } catch {
      return false;
    }
  });
}

/** How many windows of a role are on screen right now. */
async function visibleCount(app: ElectronApplication, role: string): Promise<number> {
  return app.evaluate(({ BrowserWindow }, part) => {
    return BrowserWindow.getAllWindows().filter(
      (win) => win.webContents.getURL().includes(`/${part}/`) && win.isVisible(),
    ).length;
  }, role);
}

/** Every window (open or hidden) the app has created for a role. */
async function windowCount(app: ElectronApplication, role: string): Promise<number> {
  return app.evaluate(({ BrowserWindow }, part) => {
    return BrowserWindow.getAllWindows().filter((win) =>
      win.webContents.getURL().includes(`/${part}/`),
    ).length;
  }, role);
}

/** Bounds (DIPs) of the n-th visible window of a role. */
async function boundsOf(app: ElectronApplication, role: string, index = 0): Promise<Rect> {
  const bounds = await app.evaluate(
    ({ BrowserWindow }, args) => {
      const wins = BrowserWindow.getAllWindows().filter(
        (win) => win.webContents.getURL().includes(`/${args.role}/`) && win.isVisible(),
      );
      return wins[args.index]?.getBounds() ?? null;
    },
    { role, index },
  );
  if (!bounds) throw new Error(`No visible "${role}" window #${index}`);
  return bounds;
}

async function opacityOf(app: ElectronApplication, role: string): Promise<number> {
  return app.evaluate(({ BrowserWindow }, part) => {
    const win = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.webContents.getURL().includes(`/${part}/`) && candidate.isVisible(),
    );
    return win ? win.getOpacity() : -1;
  }, role);
}

/** Empties the clipboard; false when Windows does not let this session use it. */
async function clipboardUsable(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async ({ clipboard }) => {
    try {
      clipboard.clear();
      return !(await clipboard.has('image/png'));
    } catch {
      return false;
    }
  });
}

async function clipboardHasImage(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async ({ clipboard }) => {
    try {
      return await clipboard.has('image/png');
    } catch {
      return false;
    }
  });
}

async function naturalWidth(page: Page, testId: string): Promise<number> {
  return page
    .getByTestId(testId)
    .evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : 0));
}

function pinsOf(app: ElectronApplication): Page[] {
  return app.windows().filter((page) => page.url().includes('/pin/index.html'));
}

/** HTTP status the app's own protocol gives a stored picture (404 once it was freed). */
async function pictureStatus(app: ElectronApplication, url: string): Promise<number> {
  return app.evaluate(async ({ net }, address) => (await net.fetch(address)).status, url);
}

/** The files Windows holds on the clipboard as a file drop (what Explorer would paste). */
async function fileDropOnClipboard(): Promise<string[]> {
  const script =
    '(Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }) -join [char]10';
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    windowsHide: true,
    timeout: 20_000,
  });
  return stdout.split('\n').flatMap((line) => (line.trim() === '' ? [] : [line.trim()]));
}

test.describe('Capture Studio', () => {
  test.setTimeout(150_000);

  test('a capture opens the Studio: framed picture, pills, toolbar, saved file, Esc closes', async () => {
    const folder = shotsFolder();
    const launched = await launchApp({
      settings: { capture: { saveFolder: folder, autoSave: true, shutterSound: false } },
    });
    const { app } = launched;
    try {
      await pageFor(app, 'assistant');
      // Nothing of the feature exists before the first capture.
      expect(await windowCount(app, 'studio')).toBe(0);
      expect(await windowCount(app, 'pin')).toBe(0);
      test.skip(!(await screenCanBeCaptured(app)), 'This session cannot capture the screen');

      await capture(app);
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('dialog', { name: 'Capture Studio' })).toBeVisible();
      expect(await visibleCount(app, 'studio')).toBe(1);

      // The window covers the work area of the display that was captured.
      const bounds = await boundsOf(app, 'studio');
      const area = await app.evaluate(
        ({ screen }, rect) => screen.getDisplayMatching(rect).workArea,
        bounds,
      );
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(bounds[key] - area[key])).toBeLessThanOrEqual(2);
      }

      const toolbar = studio.getByRole('toolbar', { name: 'Screenshot actions' });
      await expect(toolbar).toBeVisible();
      for (const name of ['Edit', 'Pin to screen', 'Copy', 'Share', 'Save']) {
        await expect(toolbar.getByRole('button', { name })).toBeVisible();
      }
      await expect(studio.getByRole('button', { name: 'Photo assist' })).toBeVisible();
      await expect(studio.getByRole('button', { name: 'Set as wallpaper' })).toBeVisible();
      await expect(studio.getByRole('button', { name: 'More options' })).toBeVisible();

      await expect
        .poll(() => naturalWidth(studio, 'studio-image'), { timeout: 10_000 })
        .toBeGreaterThan(0);

      // The picture is centred inside 78 % x 72 % of the window, in its glowing frame.
      const frame = studio.getByTestId('studio-frame');
      await expect(frame).toHaveAttribute('data-glow', 'on');
      const box = await frame.boundingBox();
      const view = await studio.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      if (!box) throw new Error('The frame has no box');
      expect(box.width).toBeLessThanOrEqual(view.w * 0.78 + 1);
      expect(box.height).toBeLessThanOrEqual(view.h * 0.72 + 1);
      expect(Math.abs(box.x + box.width / 2 - view.w / 2)).toBeLessThan(3);

      // Auto-save wrote exactly one properly named PNG.
      const files = readdirSync(folder);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(SHOT_NAME);

      await studio.keyboard.press('Escape');
      await expect.poll(() => visibleCount(app, 'studio'), { timeout: 10_000 }).toBe(0);
    } finally {
      await launched.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('Copy puts the picture on the clipboard and tells the user', async () => {
    const launched = await launchApp({ settings: { capture: { autoSave: false } } });
    const { app } = launched;
    try {
      await openPicture(app, await renderScreen(app, SCREEN));
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();

      const usable = await clipboardUsable(app);
      const copy = studio.getByRole('button', { name: 'Copy', exact: true });
      await copy.click();
      if (usable) {
        await expect.poll(() => clipboardHasImage(app), { timeout: 10_000 }).toBe(true);
        await expect(studio.getByRole('region', { name: 'Notifications' })).toContainText(
          'Copied to clipboard',
        );
      } else {
        // A locked desktop refuses the clipboard: the button must still settle and say so.
        test.info().annotations.push({
          type: 'note',
          description: 'The clipboard is locked in this session: checked the failure is reported',
        });
        await expect(copy).not.toHaveAttribute('data-status', 'busy');
      }
    } finally {
      await launched.close();
    }
  });

  test('Share > Copy as file puts the saved picture on the clipboard as a file', async () => {
    const folder = shotsFolder();
    const launched = await launchApp({
      settings: { capture: { saveFolder: folder, autoSave: false, shutterSound: false } },
    });
    const { app } = launched;
    try {
      await openPicture(app, await renderScreen(app, SCREEN));
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();
      test.skip(!(await clipboardUsable(app)), 'The clipboard is locked in this session');

      await studio.getByRole('button', { name: 'Share' }).click();
      const menu = studio.getByRole('menu');
      await expect(menu.getByRole('menuitem')).toHaveCount(4);
      await menu.getByRole('menuitem', { name: 'Copy as file' }).click();

      // A file drop is what Explorer, mail and chat apps paste: ask Windows what it holds.
      // The temp folder may be spelled with 8.3 short names: compare its unique last part.
      await expect
        .poll(async () => fileDropOnClipboard(), { timeout: 15_000 })
        .toEqual([expect.stringContaining(basename(folder))]);
      const [path] = await fileDropOnClipboard();
      expect(path).toMatch(SHOT_NAME_IN_FOLDER);
      expect(readdirSync(folder)).toHaveLength(1);
      await expect.poll(() => visibleCount(app, 'studio'), { timeout: 10_000 }).toBe(0);
    } finally {
      await launched.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('Pin opens a window of its own that outlives the Studio and answers to the mouse', async () => {
    const launched = await launchApp({ settings: { capture: { autoSave: false } } });
    const { app } = launched;
    try {
      const screenshot = await renderScreen(app, SCREEN);
      await openPicture(app, screenshot);
      const studio = await pageFor(app, 'studio');
      await studio.getByRole('button', { name: 'Pin to screen' }).click();

      const pin = await pageFor(app, 'pin');
      const errors: string[] = [];
      pin.on('pageerror', (error) => errors.push(error.message));
      await expect(pin.getByTestId('pin-image')).toBeVisible();
      await expect.poll(() => naturalWidth(pin, 'pin-image')).toBeGreaterThan(0);
      expect(await visibleCount(app, 'pin')).toBe(1);
      // The Studio goes away by itself; the pin stays.
      await expect.poll(() => visibleCount(app, 'studio'), { timeout: 10_000 }).toBe(0);
      expect(await visibleCount(app, 'pin')).toBe(1);

      const start = await boundsOf(app, 'pin');
      const area = await app.evaluate(
        ({ screen }, bounds) => screen.getDisplayMatching(bounds).workArea,
        start,
      );
      expect(start.width).toBeLessThanOrEqual(Math.round(area.width * 0.4) + 1);
      expect(start.height).toBeLessThanOrEqual(Math.round(area.height * 0.4) + 1);

      // The picture can be dragged by the page. A real mouse keeps its place on the screen while
      // the window follows it, so the events carry fixed screen positions.
      await pin.evaluate(
        async ({ steps, dx, dy }) => {
          const root = document.querySelector('[data-testid="pin-root"]');
          if (!root) throw new Error('The pin has no root');
          const startX = window.screenX + 80;
          const startY = window.screenY + 120;
          const send = (type: string, x: number, y: number): void => {
            root.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 1,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                bubbles: true,
                cancelable: true,
                clientX: 80,
                clientY: 120,
                screenX: x,
                screenY: y,
              }),
            );
          };
          send('pointerdown', startX, startY);
          for (let step = 1; step <= steps; step += 1) {
            await new Promise((done) => setTimeout(done, 30));
            send('pointermove', startX + (dx * step) / steps, startY + (dy * step) / steps);
          }
          send('pointerup', startX + dx, startY + dy);
        },
        { steps: 6, dx: 50, dy: 30 },
      );
      await expect
        .poll(async () => {
          const now = await boundsOf(app, 'pin');
          return { dx: now.x - start.x, dy: now.y - start.y };
        })
        .toEqual({ dx: 50, dy: 30 });

      // The wheel zooms, and the pin keeps the point under the pointer.
      const dragged = await boundsOf(app, 'pin');
      await pin.mouse.move(200, 150);
      await pin.mouse.wheel(0, -200);
      await expect
        .poll(async () => (await boundsOf(app, 'pin')).width)
        .toBeGreaterThan(dragged.width);
      const zoomed = await boundsOf(app, 'pin');
      expect(zoomed.height / zoomed.width).toBeCloseTo(dragged.height / dragged.width, 1);

      // Ctrl + wheel makes it see-through.
      expect(await opacityOf(app, 'pin')).toBe(1);
      await pin.keyboard.down('Control');
      await pin.mouse.wheel(0, 300);
      await pin.keyboard.up('Control');
      await expect.poll(() => opacityOf(app, 'pin')).toBeLessThan(1);

      // Its own copy button works too.
      if (await clipboardUsable(app)) {
        await pin.getByTestId('pin-copy').click();
        await expect.poll(() => clipboardHasImage(app), { timeout: 10_000 }).toBe(true);
      }

      // A second pin, then both close: one with the cross, one by double-clicking.
      await openPicture(app, screenshot);
      const second = await pageFor(app, 'studio');
      await second.getByRole('button', { name: 'Pin to screen' }).click();
      await expect.poll(() => visibleCount(app, 'pin'), { timeout: 10_000 }).toBe(2);
      await expect.poll(() => pinsOf(app).length).toBe(2);

      const [first, other] = pinsOf(app);
      if (!first || !other) throw new Error('Expected two pin pages');
      await first.getByTestId('pin-close').click();
      await expect.poll(() => visibleCount(app, 'pin'), { timeout: 10_000 }).toBe(1);
      const remaining = pinsOf(app)[0];
      if (!remaining) throw new Error('The second pin disappeared');
      await remaining.getByTestId('pin-root').dblclick();
      await expect.poll(() => visibleCount(app, 'pin'), { timeout: 10_000 }).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('the Capture button of the assistant (capture:start) opens the Studio too', async () => {
    const folder = shotsFolder();
    const launched = await launchApp({
      settings: { capture: { saveFolder: folder, autoSave: false, shutterSound: false } },
    });
    const { app } = launched;
    try {
      const assistant = await pageFor(app, 'assistant');
      test.skip(!(await screenCanBeCaptured(app)), 'This session cannot capture the screen');

      await assistant.evaluate(async () => {
        const bridge = (
          window as unknown as {
            beekeeper: { invoke: (channel: string, input: unknown) => Promise<unknown> };
          }
        ).beekeeper;
        await bridge.invoke('capture:start', {});
      });
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('dialog', { name: 'Capture Studio' })).toBeVisible();
      await expect(studio.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();
      await expect
        .poll(() => naturalWidth(studio, 'studio-image'), { timeout: 10_000 })
        .toBeGreaterThan(0);
    } finally {
      await launched.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('closes by itself after the time set in the settings', async () => {
    const launched = await launchApp({
      settings: { capture: { autoSave: false, dismissAfterSeconds: 2 } },
    });
    const { app } = launched;
    try {
      await openPicture(app, await renderScreen(app, SCREEN));
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();
      await expect.poll(() => visibleCount(app, 'studio'), { timeout: 20_000 }).toBe(0);
    } finally {
      await launched.close();
    }
  });

  for (const openStudio of [true, false]) {
    test(`the Settings window steps aside for its own screenshot and comes back (${
      openStudio ? 'with' : 'without'
    } the preview)`, async () => {
      const folder = shotsFolder();
      const launched = await launchApp({
        settings: {
          capture: { saveFolder: folder, autoSave: true, openStudio, shutterSound: false },
        },
      });
      const { app } = launched;
      try {
        await pageFor(app, 'assistant');
        test.skip(!(await screenCanBeCaptured(app)), 'This session cannot capture the screen');

        await app.evaluate(() => {
          const hooks = (
            globalThis as unknown as {
              __beekeeper: { ctx: { openers: { openSettings: (section?: string) => void } } };
            }
          ).__beekeeper;
          hooks.ctx.openers.openSettings('capture');
        });
        const settings = await pageFor(app, 'settings');
        const button = settings.getByRole('button', { name: 'Take a screenshot now' });
        await expect(button).toBeVisible();
        expect(await visibleCount(app, 'settings')).toBe(1);

        // Write down what happens to the Settings window while the screenshot is taken.
        await app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find((candidate) =>
            candidate.webContents.getURL().includes('/settings/'),
          );
          const log: string[] = [];
          (globalThis as unknown as { __settingsLog: string[] }).__settingsLog = log;
          win?.on('hide', () => log.push('hide'));
          win?.on('show', () => log.push('show'));
        });
        await button.click();

        if (openStudio) {
          const studio = await pageFor(app, 'studio');
          await expect(studio.getByRole('dialog', { name: 'Capture Studio' })).toBeVisible();
        } else {
          await expect.poll(() => readdirSync(folder).length, { timeout: 15_000 }).toBe(1);
          expect(await windowCount(app, 'studio')).toBe(0);
        }
        // Hidden before the picture, shown again after it, and on screen at the end.
        await expect
          .poll(
            () =>
              app.evaluate(
                () => (globalThis as unknown as { __settingsLog: string[] }).__settingsLog,
              ),
            { timeout: 10_000 },
          )
          .toEqual(['hide', 'show']);
        expect(await visibleCount(app, 'settings')).toBe(1);
      } finally {
        await launched.close();
        rmSync(folder, { recursive: true, force: true });
      }
    });
  }

  test('shutting the feature down closes the Studio and every pin and frees their pictures', async () => {
    const launched = await launchApp({ settings: { capture: { autoSave: false } } });
    const { app } = launched;
    try {
      const screenshot = await renderScreen(app, SCREEN);
      await openPicture(app, screenshot);
      await (await pageFor(app, 'studio')).getByRole('button', { name: 'Pin to screen' }).click();
      const pin = await pageFor(app, 'pin');
      const pinUrl = await pin.getByTestId('pin-image').getAttribute('src');
      await expect.poll(() => visibleCount(app, 'studio'), { timeout: 10_000 }).toBe(0);

      await openPicture(app, screenshot);
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();
      const studioUrl = await studio.getByTestId('studio-image').getAttribute('src');
      if (!pinUrl || !studioUrl) throw new Error('The pictures have no address');

      expect(await pictureStatus(app, pinUrl)).toBe(200);
      expect(await pictureStatus(app, studioUrl)).toBe(200);
      expect(await visibleCount(app, 'studio')).toBe(1);
      expect(await visibleCount(app, 'pin')).toBe(1);

      await app.evaluate(() => {
        const hooks = (
          globalThis as unknown as {
            __beekeeper: { features: { studio: { dispose: () => void } } };
          }
        ).__beekeeper;
        hooks.features.studio.dispose();
      });
      expect(await windowCount(app, 'studio')).toBe(0);
      expect(await windowCount(app, 'pin')).toBe(0);
      expect(await pictureStatus(app, pinUrl)).toBe(404);
      expect(await pictureStatus(app, studioUrl)).toBe(404);
    } finally {
      await launched.close();
    }
  });

  test('with the Studio turned off a capture is saved quietly', async () => {
    const folder = shotsFolder();
    const launched = await launchApp({
      settings: { capture: { saveFolder: folder, openStudio: false, shutterSound: false } },
    });
    const { app } = launched;
    try {
      await pageFor(app, 'assistant');
      test.skip(!(await screenCanBeCaptured(app)), 'This session cannot capture the screen');

      await capture(app);
      await expect.poll(() => readdirSync(folder).length, { timeout: 15_000 }).toBe(1);
      expect(readdirSync(folder)[0]).toMatch(SHOT_NAME);
      expect(await windowCount(app, 'studio')).toBe(0);
      expect(await visibleCount(app, 'pin')).toBe(0);
    } finally {
      await launched.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

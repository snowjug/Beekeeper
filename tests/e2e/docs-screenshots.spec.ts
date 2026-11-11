import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import koffi from 'koffi';
import { Resvg } from '@resvg/resvg-js';
import { test, type ElectronApplication, type Page } from '@playwright/test';
import {
  expect,
  lassoAround,
  launchApp,
  openAssistant,
  openCircleWithScreen,
  pageFor,
  projectRoot,
  speechWav,
  type RenderedScreen,
} from './fixtures';

/**
 * Regenerates the README screenshots in docs/screenshots from the real, running app:
 *   $env:BEEKEEPER_DOCS = '1'; npm run build; npx playwright test tests/e2e/docs-screenshots.spec.ts
 * The desktop behind the windows is replaced by a neutral wallpaper window so that no personal
 * content ends up in the images. Needs an unlocked desktop and an internet connection (weather).
 */
const OUT = process.env['BEEKEEPER_DOCS_OUT'] ?? join(projectRoot, 'docs', 'screenshots');

test.skip(process.env['BEEKEEPER_DOCS'] !== '1', 'Set BEEKEEPER_DOCS=1 to regenerate the images');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Hooks {
  __beekeeper: {
    captureRegion: (savePath: string, rect?: Rect) => Promise<void>;
    ctx: { openers: { openSettings: (section?: string) => void; openOnboarding: () => void } };
  };
}

const WALLPAPER = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;overflow:hidden;background:
  radial-gradient(55% 75% at 12% 18%, #ffd166 0, rgba(255,209,102,0) 62%),
  radial-gradient(50% 70% at 88% 22%, #b388ff 0, rgba(179,136,255,0) 64%),
  radial-gradient(65% 85% at 55% 105%, #4dd0e1 0, rgba(77,208,225,0) 66%),
  linear-gradient(135deg, #2b3a8f 0%, #5b3fa8 55%, #c0527a 100%)"></body>`;

async function showWallpaper(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow, screen }, html) => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      webPreferences: { sandbox: true },
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.showInactive();
  }, WALLPAPER);
}

async function windowBounds(app: ElectronApplication, role: string): Promise<Rect> {
  return app.evaluate(({ BrowserWindow }, part) => {
    const win = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes(`/${part}/`),
    );
    if (!win) throw new Error(`No ${part} window`);
    return win.getBounds();
  }, role);
}

async function shoot(app: ElectronApplication, name: string, rect?: Rect): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name}.png`);
  await app.evaluate(
    (_electron, args) => {
      const hooks = globalThis as unknown as Hooks;
      return hooks.__beekeeper.captureRegion(args.file, args.rect);
    },
    { file, rect },
  );
  console.log(`saved ${file}`);
}

/** The bar's card stack, with a margin, in screen DIPs. */
async function barRect(app: ElectronApplication, page: Page, margin = 28): Promise<Rect> {
  const content = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('/assistant/'),
    );
    if (!win) throw new Error('No assistant window');
    return win.getContentBounds();
  });
  const box = await page.getByRole('dialog', { name: 'Beekeeper assistant' }).boundingBox();
  if (!box) throw new Error('The assistant dialog has no box');
  return {
    x: content.x + box.x - margin,
    y: content.y + box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  };
}

async function ask(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Ask Beekeeper' });
  await input.fill(text);
  await input.press('Enter');
}

const SPEECH_PACKS = ['supertonic-3', 'whisper-small'] as const;
const speechCache = join(projectRoot, 'node_modules', '.cache', 'beekeeper', 'speech-packs');

/**
 * A user-data folder with onboarding done and, when the E2E speech cache exists, the real speech
 * packs installed, so the Voice settings show what an installed copy looks like.
 */
function seededUserData(settings: Record<string, unknown>): string {
  const userData = mkdtempSync(join(tmpdir(), 'beekeeper-docs-'));
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ onboarding: { completed: true }, ...settings }),
  );
  for (const pack of SPEECH_PACKS) {
    const source = join(speechCache, pack);
    if (existsSync(join(source, 'pack.json'))) {
      cpSync(source, join(userData, 'models', 'speech', pack), { recursive: true });
    }
  }
  return userData;
}

/** Opens Capture Studio on a picture that is already in memory (the desktop is never captured). */
async function openStudio(app: ElectronApplication, screenshot: RenderedScreen): Promise<void> {
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

interface DictationHooks {
  __beekeeper: {
    features: {
      speech: { transcribe: (request: { samples: Float32Array }) => Promise<unknown> };
      dictation: { toggle: (source: string) => void };
    };
  };
}

const user32 = koffi.load('user32.dll');
const getForegroundWindow = user32.func('intptr_t GetForegroundWindow()') as () => number;
const setForegroundWindow = user32.func('int SetForegroundWindow(intptr_t hWnd)') as (
  handle: number,
) => number;
const keybdEvent = user32.func(
  'void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)',
) as (key: number, scan: number, flags: number, extra: number) => void;
const VK_MENU = 0x12;
const KEYEVENTF_KEYUP = 0x2;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

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

const NOTES_MARKER = encodeURIComponent('id="t"');

/** A throwaway notes window with a text box, in the upper middle of the display. */
async function openNotes(app: ElectronApplication): Promise<{ handle: number; page: Page }> {
  const handle = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const html = `<title>Notes</title><body style="margin:0;background:#fffdf7;font-family:'Segoe UI',sans-serif"><div style="padding:12px 20px;font-weight:600;color:#6b5b2e;border-bottom:1px solid #f0e6c8">Notes</div><textarea id="t" autofocus style="display:block;box-sizing:border-box;width:100%;height:calc(100vh - 47px);border:0;outline:0;resize:none;padding:20px;font-size:24px;line-height:1.5;background:transparent;font-family:'Segoe UI','Nirmala UI',sans-serif;color:#1d1d1f">Friday\n</textarea></body>`;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = 760;
    const height = 280;
    const win = new BrowserWindow({
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + area.height * 0.3),
      title: 'Notes',
      autoHideMenuBar: true,
      show: true,
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.show();
    win.focus();
    return win.getNativeWindowHandle().readUInt32LE(0);
  });
  const deadline = Date.now() + 10_000;
  for (;;) {
    const page = app.windows().find((candidate) => candidate.url().includes(NOTES_MARKER));
    if (page) {
      // The caret goes after the existing text, where dictated words will land.
      await page.evaluate(() => {
        const box = document.getElementById('t') as HTMLTextAreaElement;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
      return { handle, page };
    }
    if (Date.now() > deadline) throw new Error('The notes window did not load');
    await sleep(100);
  }
}

/** The notes window and the dictation pill together, with a margin, in screen DIPs. */
async function dictationRect(app: ElectronApplication): Promise<Rect> {
  return app.evaluate(({ BrowserWindow }, marker) => {
    const boxes = BrowserWindow.getAllWindows()
      .filter((win) => {
        const url = win.webContents.getURL();
        return win.isVisible() && (url.includes('/dictation/') || url.includes(marker));
      })
      .map((win) => win.getBounds());
    if (boxes.length === 0) throw new Error('No dictation windows');
    const left = Math.min(...boxes.map((box) => box.x)) - 30;
    const top = Math.min(...boxes.map((box) => box.y)) - 30;
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + 30;
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 30;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, NOTES_MARKER);
}

/** A believable article page for the Circle to Search shot (drawn at the display's native size). */
async function articleScreen(app: ElectronApplication): Promise<RenderedScreen> {
  const display = await app.evaluate(({ screen }) => {
    const current = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return {
      width: current.bounds.width,
      height: current.bounds.height,
      scale: current.scaleFactor,
    };
  });
  const { width, height } = display;
  const left = 150;
  const headline = 'The waggle dance of the honeybee';
  const size = 46;
  const baseline = 292;
  const body = [
    'A forager that finds a rich patch of flowers returns to the hive and dances.',
    'The angle of the dance tells her sisters the direction of the food, and the',
    'length of the waggle run tells them how far they have to fly to reach it.',
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a8f"/><stop offset="0.55" stop-color="#5b3fa8"/><stop offset="1" stop-color="#c0527a"/></linearGradient>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#wall)"/>
  <rect x="${left - 40}" y="46" width="${width - 2 * (left - 40)}" height="${height - 92}" rx="14" fill="#fbfaf7"/>
  <rect x="${left - 40}" y="46" width="${width - 2 * (left - 40)}" height="44" rx="14" fill="#e9e6df"/>
  <rect x="${left - 40}" y="76" width="${width - 2 * (left - 40)}" height="14" fill="#e9e6df"/>
  <circle cx="${left - 14}" cy="68" r="6" fill="#ff5f57"/><circle cx="${left + 6}" cy="68" r="6" fill="#febc2e"/><circle cx="${left + 26}" cy="68" r="6" fill="#28c840"/>
  <rect x="${left + 70}" y="56" width="${width - 2 * left - 140}" height="24" rx="12" fill="#fbfaf7"/>
  <text x="${left + 88}" y="73" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#6b6b6b">nature.example.org/honeybees</text>
  <rect x="${left}" y="112" width="${width - 2 * left}" height="110" rx="10" fill="url(#hero)"/>
  <text x="${left}" y="${baseline}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#1d1d1f">${headline}</text>
  ${body
    .map(
      (line, index) =>
        `<text x="${left}" y="${baseline + 70 + index * 30}" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#3c3c43">${line}</text>`,
    )
    .join('\n  ')}
  <rect x="${left}" y="${baseline + 190}" width="${(width - 2 * left) * 0.62}" height="10" rx="5" fill="#d9d6ce"/>
  <rect x="${left}" y="${baseline + 216}" width="${(width - 2 * left) * 0.5}" height="10" rx="5" fill="#d9d6ce"/>
</svg>`;
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(width * display.scale) },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  })
    .render()
    .asPng();
  return {
    png: png.toString('base64'),
    boxes: {
      headline: {
        x: left - 8,
        y: baseline - size * 0.95,
        width: headline.length * size * 0.52 + 16,
        height: size * 1.25,
      },
    },
  };
}

/** An order page with made-up contact details, to show what Photo assist finds and blurs. */
async function receiptScreen(app: ElectronApplication): Promise<RenderedScreen> {
  const display = await app.evaluate(({ screen }) => {
    const current = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return {
      width: current.bounds.width,
      height: current.bounds.height,
      scale: current.scaleFactor,
    };
  });
  const { width, height } = display;
  const left = 150;
  const font = 'font-family="Segoe UI, Arial, sans-serif"';
  const rows: Array<[label: string, value: string]> = [
    ['Deliver to', 'Priya Sharma, 12 Lake View Road, Pune'],
    ['Email', 'priya.sharma@example.com'],
    ['Phone', '+91 98765 43210'],
    ['Card', '4012 8888 8888 1881'],
    ['Delivery OTP', 'OTP: 482913'],
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a8f"/><stop offset="0.55" stop-color="#5b3fa8"/><stop offset="1" stop-color="#c0527a"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#wall)"/>
  <rect x="${left - 40}" y="46" width="${width - 2 * (left - 40)}" height="${height - 92}" rx="14" fill="#fbfaf7"/>
  <rect x="${left - 40}" y="46" width="${width - 2 * (left - 40)}" height="44" rx="14" fill="#e9e6df"/>
  <rect x="${left - 40}" y="76" width="${width - 2 * (left - 40)}" height="14" fill="#e9e6df"/>
  <circle cx="${left - 14}" cy="68" r="6" fill="#ff5f57"/><circle cx="${left + 6}" cy="68" r="6" fill="#febc2e"/><circle cx="${left + 26}" cy="68" r="6" fill="#28c840"/>
  <rect x="${left + 70}" y="56" width="${width - 2 * left - 140}" height="24" rx="12" fill="#fbfaf7"/>
  <text x="${left + 88}" y="73" ${font} font-size="13" fill="#6b6b6b">shop.example.com/order/4821</text>
  <text x="${left}" y="210" ${font} font-size="52" font-weight="700" fill="#1d1d1f">Order confirmed</text>
  <text x="${left}" y="262" ${font} font-size="24" fill="#3c3c43">Thank you, Priya. Your jars of wildflower honey are on their way.</text>
  ${rows
    .map(
      ([label, value], index) =>
        `<text x="${left}" y="${360 + index * 64}" ${font} font-size="26" fill="#6b6b6b">${label}</text>
  <text x="${left + 300}" y="${360 + index * 64}" ${font} font-size="30" font-weight="600" fill="#1d1d1f">${value}</text>`,
    )
    .join('\n  ')}
  <rect x="${left}" y="${360 + rows.length * 64 + 20}" width="${(width - 2 * left) * 0.4}" height="10" rx="5" fill="#d9d6ce"/>
</svg>`;
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(width * display.scale) },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  })
    .render()
    .asPng();
  return { png: png.toString('base64'), boxes: {} };
}

test.describe('README screenshots', () => {
  test.setTimeout(240_000);

  test('assistant bar, weather, gallery, settings, onboarding and Circle to Search', async () => {
    const launched = await launchApp();
    const { app } = launched;
    try {
      await showWallpaper(app);

      // ---- assistant bar at rest, then a few answers ----
      const bar = await openAssistant(app);
      await bar.waitForTimeout(1200);
      await shoot(app, 'assistant-bar', await barRect(app, bar));

      await ask(bar, 'weather in Seattle');
      await expect(bar.locator('[data-card-kind="weather"]')).toBeVisible({ timeout: 30_000 });
      await bar.waitForTimeout(2200);
      await shoot(app, 'weather-card', await barRect(app, bar));

      await ask(bar, 'calculate 15% of 2400');
      await expect(bar.locator('[data-card-kind="calc"]')).toBeVisible();
      await bar.waitForTimeout(900);
      await shoot(app, 'calculation', await barRect(app, bar));

      await ask(bar, 'what can you do');
      await expect(bar.locator('[data-card-kind="gallery"]')).toBeVisible();
      await bar.waitForTimeout(1200);
      await shoot(app, 'command-gallery', await barRect(app, bar));

      await app.evaluate(() => {
        (
          globalThis as unknown as {
            __beekeeper: { ctx: { assistant: { hide: (reason: string) => void } } };
          }
        ).__beekeeper.ctx.assistant.hide('api');
      });
      await expect(bar.getByRole('dialog', { name: 'Beekeeper assistant' })).toBeHidden();

      // ---- Circle to Search ----
      const screenshot = await articleScreen(app);
      const overlay = await openCircleWithScreen(app, screenshot);
      await overlay.waitForTimeout(900);
      const headline = screenshot.boxes['headline'];
      if (!headline) throw new Error('missing headline box');
      await lassoAround(overlay, headline, 16);
      await expect(overlay.getByTestId('circle-text')).toContainText('waggle', { timeout: 30_000 });
      await overlay.waitForTimeout(1800);
      await shoot(app, 'circle-to-search');
      await overlay.keyboard.press('Escape');
      await overlay.waitForTimeout(800);

      // ---- Settings and onboarding ----
      await app.evaluate(() => {
        (globalThis as unknown as Hooks).__beekeeper.ctx.openers.openSettings();
      });
      const settings = await pageFor(app, 'settings');
      await expect(settings.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
      await settings.waitForTimeout(1500);
      await shoot(app, 'settings', await windowBounds(app, 'settings'));

      await app.evaluate(() => {
        (globalThis as unknown as Hooks).__beekeeper.ctx.openers.openOnboarding();
      });
      const onboarding = await pageFor(app, 'onboarding');
      await onboarding.waitForTimeout(3000);
      await shoot(app, 'onboarding', await windowBounds(app, 'onboarding'));

      await onboarding.getByRole('button', { name: 'Get started' }).click();
      await expect(onboarding.getByText('Which language do you speak?')).toBeVisible();
      await onboarding.waitForTimeout(1800);
      await shoot(app, 'onboarding-language', await windowBounds(app, 'onboarding'));
    } finally {
      await launched.close();
    }
  });

  test('Capture Studio, pinned screenshot, Voice settings and dictation', async () => {
    const shots = mkdtempSync(join(tmpdir(), 'beekeeper-docs-shots-'));
    const userData = seededUserData({
      voice: { ttsEnabled: false, earcons: false },
      capture: { autoSave: false, saveFolder: shots, shutterSound: false },
      dictation: { silenceSeconds: 2.5 },
    });
    const launched = await launchApp({ userData, fakeMic: speechWav('hello world') });
    const { app } = launched;
    try {
      await showWallpaper(app);

      // ---- Capture Studio on a picture of an article ----
      await openStudio(app, await articleScreen(app));
      const studio = await pageFor(app, 'studio');
      await expect(studio.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();
      await expect
        .poll(() =>
          studio
            .getByTestId('studio-image')
            .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
        )
        .toBeGreaterThan(0);
      await studio.waitForTimeout(2600);
      await shoot(app, 'capture-studio', await windowBounds(app, 'studio'));

      // ---- Photo assist: the text in the picture ----
      await studio.getByRole('button', { name: 'Photo assist' }).click();
      await studio.getByRole('menuitem', { name: 'Extract text' }).click();
      await expect(studio.getByTestId('studio-text')).toBeVisible({ timeout: 60_000 });
      await studio.waitForTimeout(1200);
      await shoot(app, 'capture-text', await windowBounds(app, 'studio'));
      await studio.keyboard.press('Escape');
      await studio.keyboard.press('Escape');
      await expect(studio.getByRole('dialog', { name: 'Capture Studio' })).toBeHidden();

      // ---- Photo assist: find and blur personal information ----
      await openStudio(app, await receiptScreen(app));
      const receipt = await pageFor(app, 'studio');
      await expect(receipt.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible();
      await receipt.getByRole('button', { name: 'Photo assist' }).click();
      await receipt.getByRole('menuitem', { name: 'Hide sensitive info' }).click();
      await expect(receipt.getByTestId('redaction-box').first()).toBeVisible({ timeout: 60_000 });
      await receipt.waitForTimeout(1200);
      await shoot(app, 'capture-redact', await windowBounds(app, 'studio'));
      await receipt.getByTestId('redaction-apply').click();
      await expect(receipt.getByRole('toolbar', { name: 'Screenshot actions' })).toBeVisible({
        timeout: 30_000,
      });
      await receipt.waitForTimeout(1500);
      await shoot(app, 'capture-redacted', await windowBounds(app, 'studio'));

      // ---- Pin: the picture floats over everything ----
      await receipt.getByRole('button', { name: 'Pin to screen' }).click();
      const pin = await pageFor(app, 'pin');
      await expect(pin.getByTestId('pin-image')).toBeVisible();
      await pin.waitForTimeout(1500);
      const pinBounds = await windowBounds(app, 'pin');
      await shoot(app, 'pinned-screenshot', {
        x: pinBounds.x - 40,
        y: pinBounds.y - 40,
        width: pinBounds.width + 80,
        height: pinBounds.height + 80,
      });
      await pin.getByTestId('pin-close').click();
      await expect
        .poll(() => app.windows().filter((page) => page.url().includes('/pin/')).length, {
          timeout: 10_000,
        })
        .toBe(0);

      // ---- Voice settings: the natural voice, languages and recognition model ----
      await app.evaluate(() => {
        (globalThis as unknown as Hooks).__beekeeper.ctx.openers.openSettings('voice');
      });
      const settings = await pageFor(app, 'settings');
      await expect(settings.getByRole('heading', { name: 'Voice', exact: true })).toBeVisible();
      await settings.waitForTimeout(2000);
      await shoot(app, 'settings-voice', await windowBounds(app, 'settings'));
      await settings.getByRole('group', { name: 'Natural voice' }).scrollIntoViewIfNeeded();
      await settings.waitForTimeout(900);
      await shoot(app, 'settings-voice-natural', await windowBounds(app, 'settings'));
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents.getURL().includes('/settings/')) win.hide();
        }
      });

      // ---- Dictation anywhere: the pill floats above the app you type into ----
      // A throwaway notes window has the keyboard focus, so nothing can be typed anywhere else; when
      // Windows will not hand it the focus (a locked session) the dictation shots are skipped.
      const notes = await openNotes(app);
      if (!(await takeForeground(notes.handle))) {
        console.warn(
          'Windows did not give the notes window the keyboard focus: no dictation shots',
        );
      } else {
        await app.evaluate(() => {
          const { features } = (globalThis as unknown as DictationHooks).__beekeeper;
          // Speech recognition is replaced by a fixed sentence so the shot never depends on a model.
          features.speech.transcribe = () =>
            Promise.resolve({
              text: 'call Priya about the honey order comma फिर शाम को दूध लाना full stop',
              lang: 'hi',
              model: 'small',
              durationMs: 5,
              audioMs: 2000,
            });
          features.dictation.toggle('hotkey');
        });
        const pill = await pageFor(app, 'dictation');
        const card = pill.getByTestId('dictation-pill');
        await expect(card).toBeVisible();
        await expect(card.locator('canvas')).toBeVisible({ timeout: 20_000 });
        await pill.waitForTimeout(500);
        await shoot(app, 'dictation-listening', await dictationRect(app));
        await expect
          .poll(() => notes.page.locator('#t').inputValue(), { timeout: 30_000, intervals: [25] })
          .toContain('लाना।');
        await shoot(app, 'dictation-typed', await dictationRect(app));
        const typed = await notes.page.locator('#t').inputValue();
        console.log(`typed into the notes window: ${JSON.stringify(typed)}`);
      }
    } finally {
      await launched.close();
      rmSync(userData, { recursive: true, force: true });
      rmSync(shots, { recursive: true, force: true });
    }
  });
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
    } finally {
      await launched.close();
    }
  });
});

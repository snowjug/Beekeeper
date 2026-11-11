import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

export const projectRoot = resolve(__dirname, '..', '..');
const cacheRoot = join(projectRoot, 'node_modules', '.cache', 'beekeeper');

/** The offline speech model downloaded once by `node scripts/fetch-model.mjs --dir <this folder>`. */
export const modelCacheDir = join(cacheRoot, 'models');

/**
 * Synthesises (once) a WAV of Windows' own voice saying `text`, to be used as a fake microphone.
 * `leadMs` is the silence before the words (700 ms by default): Chromium plays the file once from
 * the moment the stream opens, so a longer lead keeps the first words safe on a busy machine.
 */
export function speechWav(text: string, leadMs?: number): string {
  const folder = join(cacheRoot, 'audio');
  mkdirSync(folder, { recursive: true });
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const file = join(folder, `${slug}${leadMs === undefined ? '' : `-lead${leadMs}`}.wav`);
  if (!existsSync(file)) {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(__dirname, 'audio', 'make-wav.ps1'),
        '-Text',
        text,
        '-Out',
        file,
        ...(leadMs === undefined ? [] : ['-LeadMs', String(leadMs)]),
      ],
      { windowsHide: true },
    );
  }
  return file;
}

export interface LaunchOptions {
  /** Pre-seeded settings.json content (merged over "onboarding completed"). */
  settings?: Record<string, unknown>;
  /** Extra environment variables for the app. */
  env?: Record<string, string>;
  /** Reuse an existing user data folder (restart tests). */
  userData?: string;
  /** Install the offline voice model (from the cache) so voice features work without a download. */
  model?: boolean;
  /** WAV file played once as the microphone input (fake media device). */
  fakeMic?: string;
  /** Extra Chromium/Electron command-line switches. */
  args?: string[];
}

export interface Launched {
  app: ElectronApplication;
  userData: string;
  close: () => Promise<void>;
}

function installModel(userData: string): void {
  const target = join(userData, 'models');
  mkdirSync(target, { recursive: true });
  if (!existsSync(modelCacheDir)) {
    throw new Error(
      `The voice model is not cached: run "node scripts/fetch-model.mjs --dir ${modelCacheDir}"`,
    );
  }
  for (const name of readdirSync(modelCacheDir)) {
    copyFileSync(join(modelCacheDir, name), join(target, name));
  }
}

/** Launches the built app (out/) with an isolated user-data folder and the E2E hooks enabled. */
export async function launchApp(options: LaunchOptions = {}): Promise<Launched> {
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'beekeeper-e2e-'));
  mkdirSync(userData, { recursive: true });
  if (!options.userData) {
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        onboarding: { completed: true },
        voice: { ttsEnabled: false, earcons: false },
        ...options.settings,
      }),
    );
  }
  if (options.model) installModel(userData);
  const mediaFlags = options.fakeMic
    ? [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${options.fakeMic}%noloop`,
      ]
    : [];
  // BEEKEEPER_EXE runs the suite against a packaged build (win-unpacked\Beekeeper.exe).
  const executablePath = process.env['BEEKEEPER_EXE'];
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [projectRoot]), ...mediaFlags, ...(options.args ?? [])],
    cwd: projectRoot,
    env: {
      ...process.env,
      BEEKEEPER_E2E: '1',
      BEEKEEPER_USER_DATA: userData,
      ...options.env,
    },
    timeout: 60_000,
  });
  // Wait until the E2E hooks exist so tests never race the start-up.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ready = await app
      .evaluate(() => Boolean((globalThis as unknown as { __beekeeper?: unknown }).__beekeeper))
      .catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) throw new Error('Beekeeper did not finish starting');
    await new Promise((done) => setTimeout(done, 100));
  }
  return {
    app,
    userData,
    close: async () => {
      await app.close().catch(() => undefined);
      if (!options.userData) rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** Finds the page of a window role (e.g. "assistant") among the app's windows. */
export async function pageFor(
  app: ElectronApplication,
  role: string,
  timeoutMs = 20_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = app.windows().find((page) => page.url().includes(`/${role}/index.html`));
    if (match) {
      await match.waitForLoadState('domcontentloaded');
      return match;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Window "${role}" did not appear`);
}

/** Shows the assistant bar through the main-process hook and returns its page. */
export async function openAssistant(
  app: ElectronApplication,
  options: { listen?: boolean } = {},
): Promise<Page> {
  await app.evaluate((_electron, listen) => {
    const hooks = (
      globalThis as unknown as {
        __beekeeper: { ctx: { assistant: { show: (e: object) => void } } };
      }
    ).__beekeeper;
    hooks.ctx.assistant.show({ listen, source: listen ? 'hotkey' : 'api' });
  }, options.listen ?? false);
  const page = await pageFor(app, 'assistant');
  await expect(page.getByRole('dialog', { name: 'Beekeeper assistant' })).toBeVisible();
  return page;
}

export interface ScreenText {
  /** Key of the resulting box. */
  id: string;
  text: string;
  /** Left edge and baseline in DIPs. */
  x: number;
  baseline: number;
  /** Font size in DIPs. */
  size: number;
  bold?: boolean;
}

export interface RenderedScreen {
  /** PNG at the display's native resolution (base64). */
  png: string;
  /** Generous bounding box (DIPs, overlay coordinates) per text id. */
  boxes: Record<string, { x: number; y: number; width: number; height: number }>;
}

/**
 * Draws a synthetic "screen" (gradient + text lines) at the display's native resolution with
 * resvg. It stands in for the real desktop in Circle to Search tests, and gives exact positions to
 * circle or tap.
 */
export async function renderScreen(
  app: ElectronApplication,
  lines: readonly ScreenText[],
): Promise<RenderedScreen> {
  const display = await app.evaluate(({ screen }) => {
    const current = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return {
      width: current.bounds.width,
      height: current.bounds.height,
      scale: current.scaleFactor,
    };
  });
  const escape = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const texts = lines
    .map(
      (line) =>
        `<text x="${line.x}" y="${line.baseline}" font-family="Segoe UI, Arial, sans-serif" font-size="${line.size}" font-weight="${line.bold ? 700 : 400}" fill="#ffffff">${escape(line.text)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${display.width}" height="${display.height}" viewBox="0 0 ${display.width} ${display.height}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#5b21b6"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>${texts}</svg>`;
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(display.width * display.scale) },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  })
    .render()
    .asPng();

  const boxes: RenderedScreen['boxes'] = {};
  for (const line of lines) {
    // Average glyph width ~0.52 em: wide enough to cover the text, tight enough to exclude neighbours.
    boxes[line.id] = {
      x: line.x - 8,
      y: line.baseline - line.size * 0.95,
      width: line.text.length * line.size * 0.52 + 16,
      height: line.size * 1.25,
    };
  }
  return { png: png.toString('base64'), boxes };
}

/** Opens the Circle to Search overlay on a rendered screenshot and returns the overlay page. */
export async function openCircleWithScreen(
  app: ElectronApplication,
  screenshot: RenderedScreen,
): Promise<Page> {
  await app.evaluate(async (_electron, png) => {
    const hooks = (
      globalThis as unknown as {
        __beekeeper: { circle: { openWithImage: (png: Buffer) => Promise<void> } };
      }
    ).__beekeeper;
    await hooks.circle.openWithImage(Buffer.from(png, 'base64'));
  }, screenshot.png);
  const page = await pageFor(app, 'circle');
  await expect(page.getByTestId('circle-overlay')).toBeVisible();
  return page;
}

/** Draws a closed ellipse with the mouse around a box (a lasso). */
export async function lassoAround(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  padding = 28,
): Promise<void> {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2 + padding;
  const ry = box.height / 2 + padding;
  const steps = 40;
  await page.mouse.move(cx + rx, cy);
  await page.mouse.down();
  for (let index = 1; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    await page.mouse.move(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }
  await page.mouse.up();
}

export const test = base.extend<{ launched: Launched }>({
  // eslint-disable-next-line no-empty-pattern
  launched: async ({}, use) => {
    const launched = await launchApp();
    await use(launched);
    await launched.close();
  },
});

export { expect };

'use strict';
/**
 * Captures a page rendered by Electron to a PNG.
 *   electron scripts/capture-page.cjs --url <url|file> --out <png> [--width 1100] [--height 800]
 *            [--delay 1200] [--scale 1] [--eval "js to run before capture"]
 * Used for visual checks during development and for the README screenshots.
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const target = arg('url');
const out = arg('out');
const width = Number(arg('width', '1100'));
const height = Number(arg('height', '800'));
const delay = Number(arg('delay', '1200'));
const evalCode = arg('eval', '');
const query = arg('query', '');

if (!target || !out) {
  console.error('usage: electron capture-page.cjs --url <url> --out <png>');
  app.exit(2);
}

app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    backgroundColor: '#00000000',
    transparent: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const isUrl = /^[a-z]{2,}:/i.test(target);
  const base = isUrl ? target : pathToFileURL(resolve(target)).href;
  await win.loadURL(query ? `${base}?${query}` : base);
  if (evalCode) await win.webContents.executeJavaScript(evalCode);
  await new Promise((done) => setTimeout(done, delay));
  const image = await win.webContents.capturePage();
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), image.toPNG());
  console.log(`captured ${resolve(out)} (${image.getSize().width}x${image.getSize().height})`);
  app.exit(0);
});
